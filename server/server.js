require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY الزامی هستند.');
  process.exit(1);
}
const adminClient = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const authClient = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const digits = s => String(s ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
const validPhone = p => /^09\d{9}$/.test(p);
const emailForPhone = p => `${p}@phone.simorgh.invalid`;
const fail = (res, message, status=400) => res.status(status).json({ error: message });
const run = fn => (req,res) => Promise.resolve(fn(req,res)).catch(e => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: 'خطای سرور یا پایگاه داده' });
});
async function result(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
async function auth(req,res,next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!token) return fail(res,'ابتدا وارد حساب شوید',401);
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) return fail(res,'نشست معتبر نیست',401);
  req.user = data.user;
  next();
}
const protectedRoute = [auth];
async function profile(userId) {
  return result(adminClient.from('profiles').select('*').eq('id',userId).single());
}
async function isAdmin(userId, permission, action='view') {
  const roles = await result(adminClient.from('user_roles').select('role').eq('user_id',userId));
  if (roles.some(x => x.role === 'super_admin')) return true;
  if (!permission || !roles.some(x => x.role === 'admin')) return false;
  const p = await result(adminClient.from('admin_permissions').select('*').eq('user_id',userId).eq('permission_key',permission).maybeSingle());
  return !!p && !!p['can_'+action];
}
async function requireAdmin(req,res,permission,action='view') {
  if (!(await isAdmin(req.user.id, permission, action))) { fail(res,'دسترسی ندارید',403); return false; }
  return true;
}
async function categoryId(table,name) {
  const clean=String(name||'').trim(); if(!clean)return null;
  const found=await result(adminClient.from(table).select('id').eq('name',clean).maybeSingle());
  if(found)return found.id;
  const made=await result(adminClient.from(table).insert({name:clean}).select('id').single());
  return made.id;
}
async function notify(userId,title,body,type='general') {
  return result(adminClient.from('notifications').insert({user_id:userId,title,body:body || '',notification_type:type}));
}
const userView = async u => {
  const p = await profile(u.id);
  const roles = await result(adminClient.from('user_roles').select('role').eq('user_id',u.id));
  return { id:u.id, full_name:p.display_name || u.user_metadata?.display_name || '', phone:p.phone || u.user_metadata?.phone || '', role:roles.some(x=>x.role==='super_admin'||x.role==='admin')?'admin':'user', level:'member', member_code:p.username || '' };
};
app.get('/api/health',(req,res)=>res.json({ok:true,service:'supabase'}));

// ورود و ثبت‌نام با شماره و رمز؛ شماره در پشت‌صحنه به شناسه ایمیل داخلی تبدیل می‌شود.
// هیچ SMS یا ارائه‌دهنده پیامکی استفاده نمی‌شود.
app.post('/api/register',run(async(req,res)=>{
  const full_name=String(req.body.full_name||'').trim(), phone=digits(req.body.phone), password=String(req.body.password||'');
  if(!full_name) return fail(res,'نام را وارد کنید');
  if(!validPhone(phone)) return fail(res,'شماره همراه معتبر نیست');
  if(password.length<6) return fail(res,'رمز عبور باید حداقل ۶ کاراکتر باشد');
  const {data:created,error}=await adminClient.auth.admin.createUser({
    email:emailForPhone(phone),password,email_confirm:true,
    user_metadata:{display_name:full_name,phone}
  });
  if(error) return fail(res,error.message.includes('already')?'این شماره قبلاً ثبت‌نام کرده است':error.message, error.status===422?409:400);
  const {error:pe}=await adminClient.from('profiles').upsert({id:created.user.id,display_name:full_name,phone,profile_visibility:'private'},{onConflict:'id'});
  if(pe) { await adminClient.auth.admin.deleteUser(created.user.id); throw pe; }
  res.status(201).json({ok:true});
}));
app.post('/api/login',run(async(req,res)=>{
  const phone=digits(req.body.phone), password=String(req.body.password||'');
  if(!validPhone(phone)||!password) return fail(res,'شماره یا رمز عبور اشتباه است',401);
  const {data,error}=await authClient.auth.signInWithPassword({email:emailForPhone(phone),password});
  if(error||!data.session) return fail(res,'شماره یا رمز عبور اشتباه است',401);
  const user=await userView(data.user);
  res.json({token:data.session.access_token,refresh_token:data.session.refresh_token,user});
}));
app.post('/api/refresh',run(async(req,res)=>{
  const refresh_token=String(req.body.refresh_token||'');
  if(!refresh_token)return fail(res,'نشست منقضی شده است',401);
  const {data,error}=await authClient.auth.refreshSession({refresh_token});
  if(error||!data.session)return fail(res,'نشست منقضی شده است؛ دوباره وارد شوید',401);
  res.json({token:data.session.access_token,refresh_token:data.session.refresh_token});
}));
app.get('/api/profile',auth,run(async(req,res)=>res.json(await userView(req.user))));
app.put('/api/profile',auth,run(async(req,res)=>{
  const name=String(req.body.full_name||'').trim(); if(!name)return fail(res,'نام را وارد کنید');
  await result(adminClient.from('profiles').update({display_name:name}).eq('id',req.user.id));
  res.json(await userView(req.user));
}));

// فهرست‌های عمومی اپ
app.get('/api/menu',auth,run(async(req,res)=>{
  const rows=await result(adminClient.from('cafe_products').select('*,cafe_categories(name)').eq('is_available',true).order('sort_order'));
  res.json(rows.map(x=>({...x,category:x.cafe_categories?.name||'سایر',active:x.is_available,price:x.price_toman,image_url:x.image_path})));
}));
app.get('/api/books',auth,run(async(req,res)=>{
  const rows=await result(adminClient.from('books').select('*,book_categories(name)').eq('is_active',true).order('id',{ascending:false}));
  const mapped=rows.flatMap(x=>{
    const base={...x,category:x.book_categories?.name||'',price:x.sale_price_toman,status:x.available_copies>0?'available':'loaned',active:x.is_active,image_url:x.cover_path};
    return x.book_type==='both'?[{...base,type:'sale'},{...base,type:'loan'}]:[{...base,type:x.book_type}];
  });
  res.json(mapped);
}));
app.get('/api/art',auth,run(async(req,res)=>{
  const rows=await result(adminClient.from('store_products').select('*,store_categories(name)').eq('is_available',true).order('id',{ascending:false}));
  res.json(rows.map(x=>({...x,category:x.store_categories?.name||'',price:x.price_toman,active:x.is_available,image_url:x.image_path})));
}));
app.get('/api/events',auth,run(async(req,res)=>{
  const rows=await result(adminClient.from('events').select('*').in('status',['published','completed']).order('starts_at'));
  const regs=await result(adminClient.from('event_registrations').select('event_id,user_id,people_count,status').eq('user_id',req.user.id).neq('status','cancelled'));
  const counts=await Promise.all(rows.map(e=>adminClient.from('event_registrations').select('people_count').eq('event_id',e.id).neq('status','cancelled')));
  res.json(rows.map((e,i)=>({...e,event_date:e.starts_at,active:e.status==='published',registration_open:e.is_registration_open,capacity:e.capacity_people,registered:(counts[i].data||[]).reduce((n,x)=>n+x.people_count,0),mine:regs.some(r=>r.event_id===e.id)})));
}));

// رویداد: ثبت‌نام فردی؛ ظرفیت و وضعیت توسط سرور کنترل می‌شود.
app.post('/api/events/:id/register',auth,run(async(req,res)=>{
  const e=await result(adminClient.from('events').select('*').eq('id',req.params.id).single());
  if(e.status!=='published'||e.event_type!=='timed'||!e.is_registration_open)return fail(res,'ثبت‌نام این رویداد باز نیست');
  const p=await profile(req.user.id); if(p.is_suspended)return fail(res,'حساب شما موقتاً تعلیق شده است',403);
  const {error:registrationError}=await adminClient.rpc('register_event_atomic',{
    p_event_id:e.id,p_user_id:req.user.id,p_name:p.display_name||'',p_phone:p.phone||''
  });
  if(registrationError){
    const msg=registrationError.message||'';
    if(msg.includes('EVENT_FULL'))return fail(res,'ظرفیت رویداد تکمیل است');
    if(msg.includes('ALREADY_REGISTERED'))return fail(res,'قبلاً در این رویداد ثبت‌نام کرده‌اید',409);
    if(msg.includes('ACCOUNT_SUSPENDED'))return fail(res,'حساب شما موقتاً تعلیق شده است',403);
    if(msg.includes('REGISTRATION_CLOSED'))return fail(res,'ثبت‌نام این رویداد بسته است');
    throw registrationError;
  }
  await notify(req.user.id,'ثبت‌نام رویداد',`ثبت‌نام شما در «${e.title}» انجام شد.`);
  res.json({ok:true});
}));
app.delete('/api/events/:id/register',auth,run(async(req,res)=>{
  await result(adminClient.from('event_registrations').update({status:'cancelled'}).eq('event_id',req.params.id).eq('user_id',req.user.id));
  res.json({ok:true});
}));

// درخواست امانت و پیشنهاد کتاب
app.post('/api/loan-requests',auth,run(async(req,res)=>{
  const b=await result(adminClient.from('books').select('*').eq('id',req.body.book_id).eq('is_active',true).single());
  if(!['loan','both'].includes(b.book_type)||b.available_copies<1)return fail(res,'این کتاب برای امانت در دسترس نیست');
  const old=await result(adminClient.from('book_requests').select('id').eq('user_id',req.user.id).eq('book_id',b.id).eq('request_type','borrow').eq('status','pending').maybeSingle());
  if(old)return fail(res,'درخواست قبلی شما در حال بررسی است',409);
  await result(adminClient.from('book_requests').insert({user_id:req.user.id,book_id:b.id,request_type:'borrow',proposed_amount_toman:20000}));
  res.status(201).json({ok:true});
}));
app.get('/api/loan-requests/my',auth,run(async(req,res)=>{
  const rows=await result(adminClient.from('book_requests').select('*,books(title)').eq('user_id',req.user.id).eq('request_type','borrow').order('created_at',{ascending:false}));
  res.json(rows.map(x=>({id:x.id,book_id:x.book_id,status:x.status,created_at:x.created_at,book_title:x.books?.title})));
}));
app.post('/api/book-requests',auth,run(async(req,res)=>{
  const title=String(req.body.book_title||'').trim();if(!title)return fail(res,'عنوان کتاب الزامی است');
  await result(adminClient.from('book_requests').insert({user_id:req.user.id,request_type:'suggestion',requested_title:title,requested_author:req.body.author||null,message:req.body.description||null}));
  res.status(201).json({ok:true});
}));
app.get('/api/book-requests/my',auth,run(async(req,res)=>{
  const rows=await result(adminClient.from('book_requests').select('*').eq('user_id',req.user.id).eq('request_type','suggestion').order('created_at',{ascending:false}));
  res.json(rows.map(x=>({id:x.id,book_title:x.requested_title,author:x.requested_author,description:x.message,status:x.status,admin_note:x.admin_note,created_at:x.created_at})));
}));

// درخواست خرید حضوری: هر قلم به‌عنوان درخواست مستقل ذخیره و در خروجی در قالب قبلی نمایش داده می‌شود.
app.post('/api/purchase-requests',auth,run(async(req,res)=>{
  const items=Array.isArray(req.body.items)?req.body.items.slice(0,30):[];
  if(!items.length)return fail(res,'سبد خرید خالی است');
  const p=await profile(req.user.id);if(p.is_suspended)return fail(res,'حساب شما موقتاً تعلیق شده است',403);
  const created=[];
  for(const it of items){
    const qty=Math.min(Math.max(parseInt(it.qty)||1,1),20);
    let row,bookId=null,storeId=null,name,price;
    if(it.type==='book'){
      row=await result(adminClient.from('books').select('*').eq('id',it.id).eq('is_active',true).single());
      if(!['sale','both'].includes(row.book_type)||row.sale_price_toman==null) return fail(res,'یکی از کتاب‌ها برای فروش موجود نیست');
      bookId=row.id;name=row.title;price=row.sale_price_toman;
    } else {
      row=await result(adminClient.from('store_products').select('*').eq('id',it.id).eq('is_available',true).single());
      storeId=row.id;name=row.name;price=row.price_toman;
    }
    const pr=await result(adminClient.from('purchase_requests').insert({user_id:req.user.id,book_id:bookId,store_product_id:storeId,item_name_snapshot:name,unit_price_toman_snapshot:price,quantity:qty}).select().single());
    created.push(pr);
  }
  await notify(req.user.id,'درخواست خرید ثبت شد','درخواست خرید حضوری شما ثبت شد؛ مدیریت برای هماهنگی تماس می‌گیرد.');
  res.status(201).json({ids:created.map(x=>x.id)});
}));
app.get('/api/purchase-requests/my',auth,run(async(req,res)=>{
  const rows=await result(adminClient.from('purchase_requests').select('*').eq('user_id',req.user.id).order('created_at',{ascending:false}));
  res.json(rows.map(x=>({id:x.id,status:x.status==='pending'?'registered':x.status==='approved'?'confirmed':x.status,created_at:x.created_at,contact_phone:'',note:'',final_price:x.final_price_toman,admin_note:x.admin_note,items:[{item_type:x.book_id?'book':'art',title:x.item_name_snapshot,price:x.unit_price_toman_snapshot,qty:x.quantity,note:''}]})));
}));

// اعلان‌ها
app.get('/api/notifications',auth,run(async(req,res)=>res.json(await result(adminClient.from('notifications').select('*').eq('user_id',req.user.id).order('created_at',{ascending:false}).limit(50)))));
app.put('/api/notifications/read',auth,run(async(req,res)=>{
  await result(adminClient.from('notifications').update({is_read:true}).eq('user_id',req.user.id));res.json({ok:true});
}));

// پنل مدیریت
const RES={
  menu:{table:'cafe_products',permission:'cafe.manage',fields:{name:'name',description:'description',price:'price_toman',image_url:'image_path',sort:'sort_order',active:'is_available'}},
  books:{table:'books',permission:'library.manage',fields:{title:'title',author:'author',description:'description',category_id:'category_id',type:'book_type',price:'sale_price_toman',image_url:'cover_path',active:'is_active'}},
  art:{table:'store_products',permission:'store.manage',fields:{name:'name',description:'description',price:'price_toman',image_url:'image_path',active:'is_available'}},
  events:{table:'events',permission:'events.manage',fields:{title:'title',description:'description',event_date:'starts_at',location:'location',capacity:'capacity_people',registration_open:'is_registration_open',image_url:'poster_path'}}
};
app.get('/api/admin/:res(menu|books|art|events)',auth,run(async(req,res)=>{
  const c=RES[req.params.res];if(!await requireAdmin(req,res,c.permission))return;
  const rows=await result(adminClient.from(c.table).select('*').order('id',{ascending:false}));
  const out=[];
  for(const x of rows){
    if(req.params.res==='menu'){
      const cat=x.category_id?await result(adminClient.from('cafe_categories').select('name').eq('id',x.category_id).maybeSingle()):null;
      out.push({...x,category:cat?.name||'',price:x.price_toman,image_url:x.image_path,sort:x.sort_order,active:x.is_available});
    } else if(req.params.res==='books'){
      const cat=x.category_id?await result(adminClient.from('book_categories').select('name').eq('id',x.category_id).maybeSingle()):null;
      out.push({...x,category:cat?.name||'',type:x.book_type,price:x.sale_price_toman,status:x.available_copies>0?'available':'loaned',image_url:x.cover_path,active:x.is_active});
    } else if(req.params.res==='art'){
      const cat=x.category_id?await result(adminClient.from('store_categories').select('name').eq('id',x.category_id).maybeSingle()):null;
      out.push({...x,category:cat?.name||'',price:x.price_toman,image_url:x.image_path,active:x.is_available});
    } else out.push({...x,event_date:x.starts_at,capacity:x.capacity_people,registration_open:x.is_registration_open,image_url:x.poster_path,active:x.status==='published'});
  }
  res.json(out);
}));
app.post('/api/admin/:res(menu|books|art|events)',auth,run(async(req,res)=>{
  const c=RES[req.params.res];if(!await requireAdmin(req,res,c.permission,'create'))return;
  const data={};for(const [old,key] of Object.entries(c.fields))if(old in req.body)data[key]=req.body[old]===''?null:req.body[old];
  if(req.body.category && ['menu','books','art'].includes(req.params.res)){
    const table=req.params.res==='menu'?'cafe_categories':req.params.res==='books'?'book_categories':'store_categories';
    data.category_id=await categoryId(table,req.body.category);
  }
  if(req.params.res==='books'){
    data.total_copies=1;data.available_copies=req.body.status==='loaned'?0:1;
    if(data.book_type==='both')data.sale_price_toman=Number(req.body.price)||null;
  }
  if(req.params.res==='art' && req.body.stock_status)data.stock_status=req.body.stock_status;
  if(req.params.res==='art' && 'allow_custom' in req.body)data.allow_custom=!!req.body.allow_custom;
  if(req.params.res==='events'){data.event_type='timed';data.status='published';}
  const row=await result(adminClient.from(c.table).insert(data).select().single());res.status(201).json(row);
}));
app.put('/api/admin/:res(menu|books|art|events)/:id',auth,run(async(req,res)=>{
  const c=RES[req.params.res];if(!await requireAdmin(req,res,c.permission,'update'))return;
  const data={};for(const [old,key] of Object.entries(c.fields))if(old in req.body)data[key]=req.body[old]===''?null:req.body[old];
  if(req.body.category && ['menu','books','art'].includes(req.params.res)){
    const table=req.params.res==='menu'?'cafe_categories':req.params.res==='books'?'book_categories':'store_categories';
    data.category_id=await categoryId(table,req.body.category);
  }
  if(req.params.res==='books' && 'status' in req.body){const b=await result(adminClient.from('books').select('total_copies').eq('id',req.params.id).single());data.available_copies=req.body.status==='loaned'?0:b.total_copies;}
  if(req.params.res==='art' && req.body.stock_status)data.stock_status=req.body.stock_status;
  if(req.params.res==='art' && 'allow_custom' in req.body)data.allow_custom=!!req.body.allow_custom;
  res.json(await result(adminClient.from(c.table).update(data).eq('id',req.params.id).select().single()));
}));
app.delete('/api/admin/:res(menu|books|art|events)/:id',auth,run(async(req,res)=>{
  const c=RES[req.params.res];if(!await requireAdmin(req,res,c.permission,'delete'))return;
  const field=req.params.res==='events'?'status':req.params.res==='books'?'is_active':req.params.res==='menu'?'is_available':'is_available';
  await result(adminClient.from(c.table).update({[field]:req.params.res==='events'?'inactive':false}).eq('id',req.params.id));res.json({ok:true});
}));
app.get('/api/admin/events/:id/registrations',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'events.manage'))return;
  const rows=await result(adminClient.from('event_registrations').select('*').eq('event_id',req.params.id).neq('status','cancelled'));
  const out=[];for(const x of rows){const p=await profile(x.user_id);out.push({full_name:p.display_name,phone:p.phone,created_at:x.created_at});}
  res.json(out);
}));
app.get('/api/admin/purchase-requests',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'store.manage'))return;
  const rows=await result(adminClient.from('purchase_requests').select('*').order('created_at',{ascending:false}).limit(200));
  const out=[];for(const x of rows){const p=await profile(x.user_id);out.push({...x,status:x.status==='pending'?'registered':x.status==='approved'?'confirmed':x.status,full_name:p.display_name,phone:p.phone,contact_phone:p.phone,note:'',final_price:x.final_price_toman,items:[{title:x.item_name_snapshot,price:x.unit_price_toman_snapshot,qty:x.quantity,note:''}]});}
  res.json(out);
}));
app.put('/api/admin/purchase-requests/:id',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'store.manage','update'))return;
  const data={};if(req.body.status)data.status=({registered:'pending',reviewing:'reviewing',confirmed:'approved',awaiting_contact:'approved',ready:'approved',shipped:'approved',completed:'completed',cancelled:'cancelled'})[req.body.status]||req.body.status;if('admin_note'in req.body)data.admin_note=req.body.admin_note;if('final_price'in req.body)data.final_price_toman=req.body.final_price===''?null:Number(req.body.final_price);
  const row=await result(adminClient.from('purchase_requests').update(data).eq('id',req.params.id).select().single());
  await notify(row.user_id,'تغییر وضعیت درخواست خرید',`وضعیت درخواست «${row.item_name_snapshot}» تغییر کرد.`);res.json(row);
}));
app.get('/api/admin/loan-requests',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'library.manage'))return;
  const rows=await result(adminClient.from('book_requests').select('*,books(title)').eq('request_type','borrow').order('created_at',{ascending:false}));
  const out=[];for(const x of rows){const p=await profile(x.user_id);out.push({...x,book_title:x.books?.title,full_name:p.display_name,phone:p.phone});}
  res.json(out);
}));
app.put('/api/admin/loan-requests/:id',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'library.manage','update'))return;
  const st=req.body.status;if(!['approved','rejected'].includes(st))return fail(res,'وضعیت نامعتبر است');
  let r;
  if(st==='approved'){
    const {error}=await adminClient.rpc('approve_book_borrow_request',{p_request_id:req.params.id,p_admin_id:req.user.id});
    if(error){
      if(error.message.includes('REQUEST_NOT_PENDING'))return fail(res,'این درخواست قبلاً بررسی شده است',409);
      if(error.message.includes('NO_AVAILABLE_COPY'))return fail(res,'نسخهٔ آزاد موجود نیست');
      if(error.message.includes('USER_HAS_ACTIVE_LOAN'))return fail(res,'این عضو یک امانت فعال دارد و تا بازگشت آن نمی‌تواند کتاب دیگری امانت بگیرد.');
      throw error;
    }
    r=await result(adminClient.from('book_requests').select('*').eq('id',req.params.id).single());
  } else {
    r=await result(adminClient.from('book_requests').update({status:'rejected',reviewed_by:req.user.id,reviewed_at:new Date().toISOString()}).eq('id',req.params.id).eq('status','pending').select().maybeSingle());
    if(!r)return fail(res,'این درخواست قبلاً بررسی شده است',409);
  }
  await notify(r.user_id,'درخواست امانت',st==='approved'?'درخواست امانت شما تأیید شد.':'درخواست امانت شما رد شد.');
  res.json(r);
}));
app.put('/api/admin/books/:id/return',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'library.manage','update'))return;
  const loan=await result(adminClient.from('book_loans').select('*').eq('book_id',req.params.id).in('status',['active','overdue']).order('created_at',{ascending:true}).limit(1).maybeSingle());
  if(!loan)return fail(res,'امانت فعالی برای این کتاب پیدا نشد',404);
  await result(adminClient.from('book_loans').update({status:'returned',returned_at:new Date().toISOString()}).eq('id',loan.id));
  const b=await result(adminClient.from('books').select('available_copies,total_copies').eq('id',req.params.id).single());
  await result(adminClient.from('books').update({available_copies:Math.min(b.total_copies,b.available_copies+1)}).eq('id',req.params.id));
  res.json({ok:true});
}));
app.get('/api/admin/book-requests',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'library.manage'))return;
  const rows=await result(adminClient.from('book_requests').select('*').eq('request_type','suggestion').order('created_at',{ascending:false}));
  const out=[];for(const x of rows){const p=await profile(x.user_id);out.push({...x,book_title:x.requested_title,author:x.requested_author,description:x.message,full_name:p.display_name,phone:p.phone});}
  res.json(out);
}));
app.put('/api/admin/book-requests/:id',auth,run(async(req,res)=>{
  if(!await requireAdmin(req,res,'library.manage','update'))return;
  const data={};if(req.body.status)data.status=req.body.status;if('admin_note'in req.body)data.admin_note=req.body.admin_note;
  const row=await result(adminClient.from('book_requests').update(data).eq('id',req.params.id).select().single());
  await notify(row.user_id,'درخواست کتاب',`نتیجهٔ بررسی «${row.requested_title}» ثبت شد.`);res.json(row);
}));

app.use((req,res)=>res.status(404).json({error:'مسیر موردنظر پیدا نشد'}));
async function bootstrapAdmin() {
  const phone=digits(process.env.ADMIN_PHONE), password=String(process.env.ADMIN_PASSWORD||'');
  if(!phone && !password) return;
  if(!validPhone(phone)||password.length<8) throw new Error('برای ساخت مدیر اولیه، ADMIN_PHONE معتبر و ADMIN_PASSWORD حداقل ۸ کاراکتری لازم است.');
  const email=emailForPhone(phone);
  let user=null;
  const {data:listed,error:listError}=await adminClient.auth.admin.listUsers({page:1,perPage:1000});
  if(listError) throw listError;
  user=(listed.users||[]).find(x=>x.email===email)||null;
  if(!user){
    const {data,error}=await adminClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:process.env.ADMIN_NAME||'مدیر سیمرغ',phone}});
    if(error) throw error;
    user=data.user;
  }
  await result(adminClient.from('profiles').upsert({id:user.id,display_name:process.env.ADMIN_NAME||'مدیر سیمرغ',phone},{onConflict:'id'}));
  await result(adminClient.from('user_roles').upsert({user_id:user.id,role:'super_admin'},{onConflict:'user_id,role'}));
  console.log('حساب مدیر ارشد Supabase آماده است.');
}
const port=Number(process.env.PORT)||3000;
bootstrapAdmin().then(()=>app.listen(port,()=>console.log('Simorgh Supabase API listening on',port)))
  .catch(e=>{console.error('خطا در آماده‌سازی مدیر اولیه:',e.message);process.exit(1);});
