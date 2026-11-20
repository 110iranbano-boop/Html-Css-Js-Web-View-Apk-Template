require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY باید در تنظیمات سرور ثبت شوند.');
  process.exit(1);
}
const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'خطای سرور یا پایگاه داده' });
});
const fail = (res, message, status = 400) => res.status(status).json({ error: message });
const digits = value => String(value || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
const validPhone = value => /^09\d{9}$/.test(value);
const emailForPhone = phone => phone + '@phone.simorgh.invalid';
const db = adminDb;
const one = async (table, query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};
const profileOf = async id => {
  const [profile, roles, balance] = await Promise.all([
    one('profiles', db.from('profiles').select('*').eq('id', id).maybeSingle()),
    one('user_roles', db.from('user_roles').select('role').eq('user_id', id)),
    one('user_points_balance', db.from('user_points_balance').select('points_balance').eq('user_id', id).maybeSingle())
  ]);
  return { profile: { ...(profile || {}), points_balance: Number(balance?.points_balance || 0) }, roles: (roles || []).map(x => x.role) };
};
const phoneOf = user => digits(user.user_metadata && user.user_metadata.phone);
const displayOf = (user, profile) => profile.display_name || user.user_metadata?.display_name || '';
const grantBootstrapAdmin = async (userId, phone) => {
  const configured = digits(process.env.SUPER_ADMIN_PHONE);
  if (configured && configured === phone) {
    const { error } = await db.from('user_roles').upsert({user_id:userId,role:'super_admin'},{onConflict:'user_id,role',ignoreDuplicates:true});
    if (error) throw error;
  }
};
const userDetails = async ids => {
  const wanted = new Set(ids || []);
  if (!wanted.size) return {};
  const { data: authData, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) throw authError;
  const { data: profiles, error: profileError } = await db.from('profiles').select('id,display_name,avatar_url').in('id', [...wanted]);
  if (profileError) throw profileError;
  const pmap = Object.fromEntries((profiles || []).map(p => [p.id,p]));
  return Object.fromEntries((authData.users || []).filter(u => wanted.has(u.id)).map(u => [u.id, {
    full_name: pmap[u.id]?.display_name || u.user_metadata?.display_name || '',
    phone: phoneOf(u),
    avatar_url: pmap[u.id]?.avatar_url || null
  }]));
};
const publicUser = (user, profile, roles) => ({
  id: user.id,
  full_name: displayOf(user, profile),
  phone: phoneOf(user),
  role: roles.includes('super_admin') || roles.includes('admin') ? 'admin' : 'user',
  roles,
  level: profile.membership_level_id || null,
  member_code: 'S-' + String(user.id).slice(0, 8).toUpperCase(),
  username: profile.username || null,
  avatar_url: profile.avatar_url || null,
  bio: profile.bio || '',
  points_balance: profile.points_balance || 0,
  is_suspended: !!profile.is_suspended
});
async function auth(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 'برای ادامه وارد حساب شوید', 401);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return fail(res, 'نشست معتبر نیست', 401);
  req.user = data.user;
  const p = await profileOf(req.user.id);
  req.profile = p.profile;
  req.roles = p.roles;
  next();
}
const safeAuth = (req, res, next) => auth(req, res, next).catch(err => { console.error(err); fail(res, err.message || 'خطای احراز هویت', err.status || 500); });
const signedIn = [safeAuth];
const isAdmin = async (userId, permission, action = 'view') => {
  const { data: roles, error: roleError } = await db.from('user_roles').select('role').eq('user_id', userId);
  if (roleError) throw roleError;
  if ((roles || []).some(r => r.role === 'super_admin')) return true;
  const { data, error } = await db.from('admin_permissions').select('*').eq('user_id', userId).eq('permission_key', permission).maybeSingle();
  if (error) throw error;
  return !!(data && data['can_' + action]);
};
const admin = permission => [safeAuth, wrap(async (req, res, next) => {
  if (!await isAdmin(req.user.id, permission, 'view') && !req.roles.includes('super_admin')) return fail(res, 'دسترسی مشاهده این بخش را ندارید', 403);
  req.permission = permission;
  next();
})];
const can = async (req, permission, action) => req.roles.includes('super_admin') || isAdmin(req.user.id, permission, action);
const assertActive = async userId => {
  const p = await one('profiles', db.from('profiles').select('is_suspended').eq('id', userId).single());
  if (p?.is_suspended) {
    const e = new Error('حساب شما به دلیل وضعیت تعلیق امکان ثبت عملیات جدید ندارد.');
    e.status = 403; throw e;
  }
};
app.use((err, req, res, next) => {
  if (err) return fail(res, err.message || 'خطا', err.status || 500);
  next();
});
app.get('/api/health', (req, res) => res.json({ ok: true, provider: 'supabase' }));

// شماره موبایل در لایه برنامه به یک ایمیل داخلی غیرقابل دریافت تبدیل می‌شود.
// این روش از Phone OTP/SMS استفاده نمی‌کند؛ رمز عبور همچنان توسط Supabase Auth نگهداری می‌شود.
app.post('/api/register', wrap(async (req, res) => {
  const full_name = String(req.body.full_name || '').trim();
  const phone = digits(req.body.phone);
  const password = String(req.body.password || '');
  if (!full_name) return fail(res, 'نام و نام خانوادگی را وارد کنید');
  if (!validPhone(phone)) return fail(res, 'شماره همراه معتبر نیست');
  if (password.length < 6) return fail(res, 'رمز عبور باید حداقل ۶ کاراکتر باشد');
  const { data: existing } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if ((existing?.users || []).some(u => phoneOf(u) === phone)) return fail(res, 'این شماره قبلاً ثبت‌نام کرده است', 409);
  const { data, error } = await db.auth.admin.createUser({
    email: emailForPhone(phone),
    password,
    email_confirm: true,
    user_metadata: { phone, display_name: full_name }
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return fail(res, 'این شماره قبلاً ثبت‌نام کرده است', 409);
    throw error;
  }
  const { data: sign, error: signError } = await authClient.auth.signInWithPassword({ email: emailForPhone(phone), password });
  if (signError) throw signError;
  await grantBootstrapAdmin(data.user.id, phone);
  const p = await profileOf(data.user.id);
  res.status(201).json({ ok: true, token: sign.session.access_token, refresh_token: sign.session.refresh_token, user: publicUser(sign.user, p.profile, p.roles) });
}));
app.post('/api/login', wrap(async (req, res) => {
  const phone = digits(req.body.phone), password = String(req.body.password || '');
  if (!validPhone(phone) || !password) return fail(res, 'شماره همراه یا رمز عبور اشتباه است', 401);
  const { data, error } = await authClient.auth.signInWithPassword({ email: emailForPhone(phone), password });
  if (error || !data.user) return fail(res, 'شماره یا رمز عبور اشتباه است', 401);
  await grantBootstrapAdmin(data.user.id, phone);
  const p = await profileOf(data.user.id);
  res.json({ token: data.session.access_token, refresh_token: data.session.refresh_token, user: publicUser(data.user, p.profile, p.roles) });
}));
app.post('/api/refresh', wrap(async (req,res)=>{
  const refresh_token=String(req.body.refresh_token||'');
  if(!refresh_token) return fail(res,'نشست منقضی شده است',401);
  const {data,error}=await authClient.auth.refreshSession({refresh_token});
  if(error||!data.session) return fail(res,'نشست منقضی شده است؛ دوباره وارد شوید',401);
  res.json({token:data.session.access_token,refresh_token:data.session.refresh_token});
}));
app.get('/api/profile', ...signedIn, wrap(async (req, res) => res.json(publicUser(req.user, req.profile, req.roles))));
app.put('/api/profile', ...signedIn, wrap(async (req, res) => {
  await assertActive(req.user.id);
  const patch = {};
  if (req.body.full_name !== undefined) patch.display_name = String(req.body.full_name).trim();
  if (req.body.username !== undefined) patch.username = String(req.body.username).trim() || null;
  if (req.body.bio !== undefined) patch.bio = String(req.body.bio).slice(0, 500);
  if (req.body.avatar_url !== undefined) patch.avatar_url = req.body.avatar_url;
  if (req.body.profile_visibility !== undefined) patch.profile_visibility = req.body.profile_visibility;
  const { data, error } = await db.from('profiles').update(patch).eq('id', req.user.id).select().single();
  if (error) throw error;
  const { error: metaError } = await db.auth.admin.updateUserById(req.user.id, { user_metadata: { ...req.user.user_metadata, display_name: data.display_name } });
  if (metaError) throw metaError;
  res.json(publicUser({ ...req.user, user_metadata: { ...req.user.user_metadata, display_name: data.display_name } }, data, req.roles));
}));

// کافه، کتابخانه و فروشگاه: خروجی سازگار با رابط فعلی و داده‌های جداول جدید
app.get('/api/menu', ...signedIn, wrap(async (req, res) => {
  const { data, error } = await db.from('cafe_products').select('*, cafe_categories(name)').eq('is_available', true).order('sort_order');
  if (error) throw error;
  res.json((data || []).map(x => ({ id:x.id, name:x.name, title:x.name, category:x.cafe_categories?.name || '', description:x.description, price:x.price_toman, image_url:x.image_path, active:x.is_available })));
}));
app.get('/api/books', ...signedIn, wrap(async (req, res) => {
  const { data, error } = await db.from('books').select('*, book_categories(name)').eq('is_active', true).order('id', { ascending:false });
  if (error) throw error;
  res.json((data || []).map(x => ({ id:x.id, title:x.title, author:x.author, description:x.description, category:x.book_categories?.name || '', type:x.book_type === 'both' ? (x.available_copies > 0 ? 'loan' : 'sale') : x.book_type, price:x.sale_price_toman, status:x.available_copies > 0 ? 'available' : 'loaned', available_copies:x.available_copies, image_url:x.cover_path, active:x.is_active })));
}));
app.get('/api/art', ...signedIn, wrap(async (req, res) => {
  const { data, error } = await db.from('store_products').select('*, store_categories(name)').eq('is_available', true).order('id', { ascending:false });
  if (error) throw error;
  res.json((data || []).map(x => ({ id:x.id, name:x.name, category:x.store_categories?.name || '', description:x.description, price:x.price_toman, image_url:x.image_path, stock_status:'in_stock', allow_custom:false, active:x.is_available })));
}));
app.get('/api/events', ...signedIn, wrap(async (req, res) => {
  const { data, error } = await db.from('events').select('*').eq('status','published').order('starts_at');
  if (error) throw error;
  const ids = (data || []).map(x => x.id);
  const { data: regs, error: re } = ids.length ? await db.from('event_registrations').select('event_id,user_id,people_count').in('event_id',ids) : {data:[],error:null};
  if (re) throw re;
  res.json((data || []).map(e => {
    const rs=(regs||[]).filter(r=>r.event_id===e.id);
    return { id:e.id,title:e.title,description:e.description,event_date:e.starts_at,location:'',capacity:e.capacity_people,registered:rs.reduce((n,r)=>n+r.people_count,0),mine:rs.some(r=>r.user_id===req.user.id),registration_open:e.is_registration_open && e.event_type==='timed',active:e.status==='published',image_url:e.poster_path,event_type:e.event_type,required_teammates:e.required_teammates,points_on_registration:e.points_on_registration,rules_text:e.rules_text };
  }));
}));

// درخواست‌های کتاب؛ امانت و پیشنهاد/تهیه کتاب در book_requests ثبت می‌شوند.
app.post('/api/loan-requests', ...signedIn, wrap(async (req,res)=>{
  await assertActive(req.user.id);
  const bookId=Number(req.body.book_id), amount=Number(req.body.proposed_amount_toman || req.body.amount || 20000);
  if(!Number.isInteger(bookId)) return fail(res,'کتاب انتخاب‌شده معتبر نیست');
  if(amount<20000) return fail(res,'پیشنهاد زیر ۲۰ هزار تومان تأیید نمی‌شود');
  const { data: active }=await db.from('book_loans').select('id').eq('user_id',req.user.id).in('status',['active','overdue']).limit(1);
  if(active?.length) return fail(res,'تا زمان بازگرداندن کتاب قبلی امکان درخواست امانت جدید ندارید');
  const { data: pending }=await db.from('book_requests').select('id').eq('user_id',req.user.id).eq('request_type','borrow').eq('status','pending').limit(1);
  if(pending?.length) return fail(res,'درخواست امانت قبلی شما در حال بررسی است');
  const { error }=await db.from('book_requests').insert({user_id:req.user.id,book_id:bookId,request_type:'borrow',proposed_amount_toman:amount});
  if(error) throw error;
  res.status(201).json({ok:true});
}));
app.get('/api/loan-requests/my', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('book_requests').select('*, books(title), book_loans(id,status,current_due_at,handed_over_at)').eq('user_id',req.user.id).eq('request_type','borrow').order('created_at',{ascending:false});
  if(error) throw error;
  res.json((data||[]).map(x=>({id:x.id,book_title:x.books?.title||'کتاب',status:x.status,created_at:x.created_at,loan:x.book_loans?.[0]||null})));
}));
app.post('/api/book-requests', ...signedIn, wrap(async(req,res)=>{
  await assertActive(req.user.id);
  const title=String(req.body.book_title||'').trim();
  if(!title) return fail(res,'عنوان کتاب الزامی است');
  const {error}=await db.from('book_requests').insert({user_id:req.user.id,request_type:'suggestion',requested_title:title,requested_author:req.body.author||null,message:req.body.description||null});
  if(error) throw error;
  res.status(201).json({ok:true});
}));
app.get('/api/book-requests/my', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('book_requests').select('*').eq('user_id',req.user.id).neq('request_type','borrow').order('created_at',{ascending:false});
  if(error) throw error;
  res.json((data||[]).map(x=>({id:x.id,book_title:x.requested_title||'درخواست کتاب',author:x.requested_author,status:x.status,admin_note:x.admin_note,description:x.message,created_at:x.created_at})));
}));

// خرید حضوری؛ هر قلم یک درخواست مستقل در مدل نهایی
app.post('/api/purchase-requests', ...signedIn, wrap(async(req,res)=>{
  await assertActive(req.user.id);
  const items=Array.isArray(req.body.items)?req.body.items.slice(0,30):[];
  if(!items.length) return fail(res,'سبد خرید خالی است');
  const phone=digits(req.body.contact_phone||phoneOf(req.user));
  if(!validPhone(phone)) return fail(res,'شماره تماس معتبر نیست');
  const created=[];
  for(const it of items){
    const qty=Math.min(Math.max(parseInt(it.qty,10)||1,1),99);
    let row, error;
    if(it.type==='book'){
      ({data:row,error}=await db.from('books').select('id,title,sale_price_toman,book_type,is_active').eq('id',it.id).single());
      if(error||!row||!row.is_active||!['sale','both'].includes(row.book_type)) return fail(res,'کتاب انتخاب‌شده برای فروش موجود نیست');
      const r=await db.from('purchase_requests').insert({user_id:req.user.id,book_id:row.id,item_name_snapshot:row.title,unit_price_toman_snapshot:row.sale_price_toman||0,quantity:qty}).select('id').single();
      if(r.error) throw r.error; created.push(r.data.id);
    } else {
      ({data:row,error}=await db.from('store_products').select('id,name,price_toman,is_available').eq('id',it.id).single());
      if(error||!row||!row.is_available) return fail(res,'محصول انتخاب‌شده موجود نیست');
      const r=await db.from('purchase_requests').insert({user_id:req.user.id,store_product_id:row.id,item_name_snapshot:row.name,unit_price_toman_snapshot:row.price_toman,quantity:qty}).select('id').single();
      if(r.error) throw r.error; created.push(r.data.id);
    }
  }
  res.status(201).json({id:created[0],ids:created});
}));
app.get('/api/purchase-requests/my', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('purchase_requests').select('*').eq('user_id',req.user.id).order('created_at',{ascending:false});
  if(error) throw error;
  res.json((data||[]).map(x=>({id:x.id,status:x.status,created_at:x.created_at,final_price:x.unit_price_toman_snapshot*x.quantity,admin_note:x.admin_note,items:[{title:x.item_name_snapshot,qty:x.quantity,price:x.unit_price_toman_snapshot}]})));
}));

app.get('/api/notifications', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('notifications').select('*').eq('user_id',req.user.id).order('created_at',{ascending:false}).limit(100);
  if(error) throw error; res.json(data||[]);
}));
app.put('/api/notifications/read', ...signedIn, wrap(async(req,res)=>{
  const {error}=await db.from('notifications').update({is_read:true}).eq('user_id',req.user.id);
  if(error) throw error; res.json({ok:true});
}));

// رویدادها و ثبت‌نام گروهی
app.post('/api/events/:id/register', ...signedIn, wrap(async(req,res)=>{
  await assertActive(req.user.id);
  const {data:event,error}=await db.from('events').select('*').eq('id',req.params.id).single();
  if(error||!event||event.status!=='published'||event.event_type!=='timed'||!event.is_registration_open) return fail(res,'ثبت‌نام این رویداد در دسترس نیست');
  const existing=await db.from('event_registrations').select('id').eq('event_id',event.id).eq('user_id',req.user.id).maybeSingle();
  if(existing.data) return fail(res,'شما قبلاً در این رویداد ثبت‌نام کرده‌اید');
  const name=String(req.body.registrant_name||req.user.user_metadata?.display_name||'عضو').trim();
  const phone=digits(req.body.registrant_phone||phoneOf(req.user));
  const teammates=Array.isArray(req.body.teammates)?req.body.teammates:[];
  if(!validPhone(phone)||teammates.length!==event.required_teammates) return fail(res,'اطلاعات ثبت‌نام‌کننده یا تعداد همراهان معتبر نیست');
  const people=[{person_role:'registrant',full_name:name,phone,sort_order:0},...teammates.map((p,i)=>({person_role:'teammate',full_name:String(p.full_name||'').trim(),phone:digits(p.phone),sort_order:i+1}))];
  if(people.some(p=>!p.full_name||!validPhone(p.phone))) return fail(res,'نام و شماره تماس همه افراد الزامی است');
  const {data:registrationId,error:regError}=await db.rpc('register_event_atomic',{p_event_id:event.id,p_user_id:req.user.id,p_registrant_name:name,p_registrant_phone:phone,p_teammates:teammates});
  if(regError) return fail(res,regError.message||'ثبت‌نام انجام نشد',409);
  res.status(201).json({ok:true,id:registrationId});
}));
app.delete('/api/events/:id/register', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.rpc('cancel_event_registration_atomic',{p_event_id:Number(req.params.id),p_user_id:req.user.id});
  if(error) return fail(res,error.message||'لغو ثبت‌نام انجام نشد',409);
  res.json({ok:true,points_delta:data});
}));

// تاالر سیمرغ
app.get('/api/loans/my', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('book_loans').select('*,books(title,author,cover_path)').eq('user_id',req.user.id).order('created_at',{ascending:false});
  if(error) throw error; res.json(data||[]);
}));
app.get('/api/book-fines/my', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('book_fines').select('*').eq('user_id',req.user.id).order('fine_date',{ascending:false});
  if(error) throw error; res.json(data||[]);
}));
app.post('/api/loans/:id/extensions', ...signedIn, wrap(async(req,res)=>{
  await assertActive(req.user.id);
  const {data:loan,error:loanError}=await db.from('book_loans').select('id,user_id,status').eq('id',req.params.id).single();
  if(loanError||!loan||loan.user_id!==req.user.id||!['active','overdue'].includes(loan.status)) return fail(res,'امانت فعال پیدا نشد',404);
  const {data:pending}=await db.from('loan_extensions').select('id').eq('loan_id',loan.id).eq('status','pending').maybeSingle();
  if(pending) return fail(res,'درخواست تمدید قبلی در حال بررسی است');
  const {data,error}=await db.from('loan_extensions').insert({loan_id:loan.id}).select().single();
  if(error) throw error; res.status(201).json(data);
}));
app.get('/api/admin/loan-extensions', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','view')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.from('loan_extensions').select('*,book_loans(book_id,user_id,books(title))').order('requested_at',{ascending:false});
  if(error) throw error; res.json(data||[]);
}));
app.put('/api/admin/loan-extensions/:id', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','update')) return fail(res,'دسترسی ندارید',403);
  const status=req.body.status; if(!['approved','rejected'].includes(status)) return fail(res,'وضعیت نامعتبر است');
  const {data:ext,error}=await db.from('loan_extensions').select('*').eq('id',req.params.id).eq('status','pending').single();
  if(error||!ext) return fail(res,'درخواست تمدید قبلاً بررسی شده است',409);
  let patch={status,decided_by:req.user.id,decided_at:new Date().toISOString()};
  if(status==='approved'){
    const {data:loan,error:le}=await db.from('book_loans').select('current_due_at').eq('id',ext.loan_id).single();
    if(le) throw le;
    const next=new Date(new Date(loan.current_due_at).getTime()+7*86400000).toISOString();
    patch.previous_due_at=loan.current_due_at; patch.new_due_at=next;
    const {error:updateLoan}=await db.from('book_loans').update({current_due_at:next,status:'active'}).eq('id',ext.loan_id);
    if(updateLoan) throw updateLoan;
  }
  const {data,error:updateError}=await db.from('loan_extensions').update(patch).eq('id',ext.id).select().single();
  if(updateError) throw updateError; res.json(data);
}));
app.post('/api/internal/run-loan-penalties', wrap(async(req,res)=>{
  if(!process.env.CRON_SECRET||req.headers['x-cron-secret']!==process.env.CRON_SECRET) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.rpc('apply_loan_late_fines');
  if(error) throw error; res.json({ok:true,fines_created:data});
}));
app.put('/api/admin/book-fines/:id/settle', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','update')) return fail(res,'دسترسی ندارید',403);
  const {data:fine,error}=await db.from('book_fines').update({status:'settled',settled_at:new Date().toISOString()}).eq('id',req.params.id).eq('status','open').select().single();
  if(error) throw error;
  const {data:openFines}=await db.from('book_fines').select('id').eq('user_id',fine.user_id).eq('status','open').limit(1);
  const {data:openLoans}=await db.from('book_loans').select('id').eq('user_id',fine.user_id).in('status',['active','overdue']).limit(1);
  if(!openFines?.length&&!openLoans?.length) await db.from('profiles').update({is_suspended:false,suspension_reason:null,suspended_at:null,suspension_ends_at:null}).eq('id',fine.user_id);
  res.json({ok:true});
}));
app.put('/api/admin/event-attendance/:personId', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'events.manage','update')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.rpc('mark_event_attendance_atomic',{p_registration_person_id:req.params.personId,p_attendance_status:req.body.status,p_admin_id:req.user.id});
  if(error) return fail(res,error.message||'ثبت حضور انجام نشد',409);
  res.json({ok:true,points_delta:data});
}));
app.get('/api/forum/topics', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('forum_topics').select('*, forum_topic_images(*)').eq('status','published').order('created_at',{ascending:false});
  if(error) throw error;
  const authors=await userDetails((data||[]).map(x=>x.user_id));
  res.json((data||[]).map(x=>({...x,profiles:{display_name:authors[x.user_id]?.full_name||'',avatar_url:authors[x.user_id]?.avatar_url||null}})));
}));
app.post('/api/forum/topics', ...signedIn, wrap(async(req,res)=>{
  await assertActive(req.user.id);
  const title=String(req.body.title||'').trim(), body=String(req.body.body||'').trim();
  if(!title||!body) return fail(res,'عنوان و متن تاپیک الزامی است');
  const {data:perm}=await db.from('forum_permissions').select('can_create_topic').eq('user_id',req.user.id).maybeSingle();
  if(!perm?.can_create_topic) return fail(res,'مجوز ایجاد تاپیک برای حساب شما فعال نیست',403);
  const {data,error}=await db.from('forum_topics').insert({user_id:req.user.id,title,body}).select().single();
  if(error) throw error; res.status(201).json(data);
}));
app.get('/api/forum/topics/:id/comments', ...signedIn, wrap(async(req,res)=>{
  const {data,error}=await db.from('forum_comments').select('*').eq('topic_id',req.params.id).eq('status','published').order('created_at');
  if(error) throw error;
  const authors=await userDetails((data||[]).map(x=>x.user_id));
  res.json((data||[]).map(x=>({...x,profiles:{display_name:authors[x.user_id]?.full_name||'',avatar_url:authors[x.user_id]?.avatar_url||null}})));
}));
app.post('/api/forum/topics/:id/comments', ...signedIn, wrap(async(req,res)=>{
  await assertActive(req.user.id);
  const body=String(req.body.body||'').trim(); if(!body) return fail(res,'متن نظر الزامی است');
  const {data,error}=await db.from('forum_comments').insert({topic_id:req.params.id,user_id:req.user.id,parent_id:req.body.parent_id||null,body}).select().single();
  if(error) throw error; res.status(201).json(data);
}));

// پنل مدیریت؛ مجوزها برای هر حوزه جداگانه کنترل می‌شوند.
const categoryTables = { menu:'cafe_categories', books:'book_categories', art:'store_categories' };
const resolveCategory = async (resource, name) => {
  const table=categoryTables[resource], value=String(name||'').trim();
  if(!table || !value) return null;
  const {data:found,error}=await db.from(table).select('id').eq('name',value).limit(1).maybeSingle();
  if(error) throw error;
  if(found) return found.id;
  const {data,error:insertError}=await db.from(table).insert({name:value}).select('id').single();
  if(insertError) throw insertError;
  return data.id;
};
const attachCategories = async (resource, rows) => {
  const table=categoryTables[resource];
  if(!table || !rows.length) return rows;
  const {data:cats,error}=await db.from(table).select('id,name');
  if(error) throw error;
  const names=Object.fromEntries((cats||[]).map(x=>[x.id,x.name]));
  return rows.map(x=>({...x,category:names[x.category_id]||''}));
};
const resources={
 menu:{table:'cafe_products',permission:'cafe.manage',mapIn:b=>({name:b.name,description:b.description,price_toman:b.price,image_path:b.image_url,sort_order:b.sort,is_available:b.active!==false,category_id:b.category_id||null}),mapOut:r=>({...r,title:r.name,price:r.price_toman,image_url:r.image_path,active:r.is_available})},
 books:{table:'books',permission:'library.manage',mapIn:b=>({title:b.title,author:b.author,description:b.description,book_type:b.type||'loan',sale_price_toman:b.price||null,cover_path:b.image_url,is_active:b.active!==false,total_copies:Number(b.total_copies??1),available_copies:Number(b.available_copies??1)}),mapOut:r=>({...r,type:r.book_type,price:r.sale_price_toman,image_url:r.cover_path,active:r.is_active,status:r.available_copies>0?'available':'loaned'})},
 art:{table:'store_products',permission:'store.manage',mapIn:b=>({name:b.name,description:b.description,price_toman:b.price,image_path:b.image_url,is_available:b.active!==false,category_id:b.category_id||null}),mapOut:r=>({...r,price:r.price_toman,image_url:r.image_path,active:r.is_available})},
 events:{table:'events',permission:'events.manage',mapIn:b=>({title:b.title,description:b.description,starts_at:b.event_date,event_type:b.event_type||'timed',capacity_people:b.capacity||null,is_registration_open:b.registration_open!==false,poster_path:b.image_url,status:b.active===false?'inactive':'published',required_teammates:Number(b.required_teammates||0),rules_text:b.rules_text||null}),mapOut:r=>({...r,event_date:r.starts_at,capacity:r.capacity_people,registration_open:r.is_registration_open,image_url:r.poster_path,active:r.status==='published'})}
};
app.get('/api/admin/:res(menu|books|art|events)', ...signedIn, wrap(async(req,res)=>{
  const r=resources[req.params.res]; if(!await can(req,r.permission,'view')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.from(r.table).select('*').order('id',{ascending:false}); if(error) throw error;
  const rows=await attachCategories(req.params.res,data||[]);
  res.json(rows.map(r.mapOut));
}));
app.post('/api/admin/:res(menu|books|art|events)', ...signedIn, wrap(async(req,res)=>{
  const r=resources[req.params.res]; if(!await can(req,r.permission,'create')) return fail(res,'دسترسی ایجاد ندارید',403);
  const payload=r.mapIn(req.body);
  if(categoryTables[req.params.res] && req.body.category!==undefined) payload.category_id=await resolveCategory(req.params.res,req.body.category);
  const {data,error}=await db.from(r.table).insert(payload).select().single(); if(error) throw error;
  res.status(201).json(r.mapOut({...data,category:req.body.category||''}));
}));
app.put('/api/admin/:res(menu|books|art|events)/:id', ...signedIn, wrap(async(req,res)=>{
  const r=resources[req.params.res]; if(!await can(req,r.permission,'update')) return fail(res,'دسترسی ویرایش ندارید',403);
  const payload=r.mapIn(req.body);
  if(categoryTables[req.params.res] && req.body.category!==undefined) payload.category_id=await resolveCategory(req.params.res,req.body.category);
  const {data,error}=await db.from(r.table).update(payload).eq('id',req.params.id).select().single(); if(error) throw error;
  res.json(r.mapOut({...data,category:req.body.category||''}));
}));
app.delete('/api/admin/:res(menu|books|art|events)/:id', ...signedIn, wrap(async(req,res)=>{
  const r=resources[req.params.res]; if(!await can(req,r.permission,'delete')) return fail(res,'دسترسی حذف ندارید',403);
  const patch=r.table==='events'?{status:'inactive'}:r.table==='books'?{is_active:false}:r.table==='cafe_products'?{is_available:false}:{is_available:false};
  const {error}=await db.from(r.table).update(patch).eq('id',req.params.id); if(error) throw error;
  res.json({ok:true});
}));
app.get('/api/admin/purchase-requests', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'store.manage','view')&&!await can(req,'library.manage','view')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.from('purchase_requests').select('*').order('created_at',{ascending:false}).limit(200); if(error) throw error;
  const users=await userDetails((data||[]).map(x=>x.user_id));
  res.json((data||[]).map(x=>({...x,full_name:users[x.user_id]?.full_name||'',contact_phone:users[x.user_id]?.phone||'',final_price:x.unit_price_toman_snapshot*x.quantity,items:[{title:x.item_name_snapshot,qty:x.quantity,price:x.unit_price_toman_snapshot}]})));
}));
app.put('/api/admin/purchase-requests/:id', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'store.manage','update')&&!await can(req,'library.manage','update')) return fail(res,'دسترسی ندارید',403);
  const patch={}; if(req.body.status) patch.status=req.body.status; if(req.body.admin_note!==undefined) patch.admin_note=req.body.admin_note;
  const {data,error}=await db.from('purchase_requests').update(patch).eq('id',req.params.id).select().single(); if(error) throw error; res.json(data);
}));
app.get('/api/admin/loan-requests', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','view')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.from('book_requests').select('*,books(title)').eq('request_type','borrow').order('created_at',{ascending:false}); if(error) throw error;
  const users=await userDetails((data||[]).map(x=>x.user_id));
  res.json((data||[]).map(x=>({id:x.id,book_title:x.books?.title||'کتاب',status:x.status,user_id:x.user_id,full_name:users[x.user_id]?.full_name||'',phone:users[x.user_id]?.phone||'',proposed_amount_toman:x.proposed_amount_toman})));
}));
app.put('/api/admin/loan-requests/:id', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','update')) return fail(res,'دسترسی ندارید',403);
  const status=req.body.status; if(!['approved','rejected'].includes(status)) return fail(res,'وضعیت نامعتبر است');
  if(status==='approved'){
    const {data:loanId,error}=await db.rpc('approve_book_borrow_request',{p_request_id:req.params.id,p_admin_id:req.user.id});
    if(error) return fail(res,error.message||'تأیید امانت انجام نشد',409);
    return res.json({ok:true,status,loan_id:loanId});
  }
  const {error}=await db.from('book_requests').update({status:'rejected',reviewed_by:req.user.id,reviewed_at:new Date().toISOString()}).eq('id',req.params.id).eq('status','pending');
  if(error) throw error;
  res.json({ok:true,status});
}));
app.put('/api/admin/books/:id/return', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','update')) return fail(res,'دسترسی ندارید',403);
  const {data:loanId,error}=await db.rpc('return_book_atomic',{p_book_id:Number(req.params.id)});
  if(error) return fail(res,error.message||'ثبت بازگشت انجام نشد',409);
  res.json({ok:true,loan_id:loanId});
}));
app.get('/api/admin/book-requests', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','view')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.from('book_requests').select('*').neq('request_type','borrow').order('created_at',{ascending:false}); if(error) throw error;
  res.json((data||[]).map(x=>({id:x.id,book_title:x.requested_title||'درخواست کتاب',author:x.requested_author,description:x.message,status:x.status,admin_note:x.admin_note,user_id:x.user_id})));
}));
app.put('/api/admin/book-requests/:id', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'library.manage','update')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.from('book_requests').update({status:req.body.status,admin_note:req.body.admin_note,reviewed_by:req.user.id,reviewed_at:new Date().toISOString()}).eq('id',req.params.id).select().single();
  if(error) throw error; res.json(data);
}));
app.get('/api/admin/events/:id/registrations', ...signedIn, wrap(async(req,res)=>{
  if(!await can(req,'events.manage','view')) return fail(res,'دسترسی ندارید',403);
  const {data,error}=await db.from('event_registrations').select('*,event_registration_people(*)').eq('event_id',req.params.id); if(error) throw error;
  const users=await userDetails((data||[]).map(x=>x.user_id));
  res.json((data||[]).map(x=>({...x,full_name:users[x.user_id]?.full_name||x.registrant_name,phone:users[x.user_id]?.phone||x.registrant_phone})));
}));

// Serve web build
const www=path.join(__dirname,'..','www');
if(fs.existsSync(www)) app.use(express.static(www));
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log('Simorgh Supabase API listening on '+port));
