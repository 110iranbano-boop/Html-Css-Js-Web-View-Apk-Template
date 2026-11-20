require('dotenv').config();
const express = require('express'), cors = require('cors'), bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'), { Pool } = require('pg'), fs = require('fs'), path = require('path');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('JWT_SECRET تنظیم نشده یا کوتاه است'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false });
const q = (s, p) => pool.query(s, p).then(r => r.rows);
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const wrap = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'خطای سرور' }); });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const digits = s => String(s ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
const validPhone = p => /^09\d{9}$/.test(p);
const notify = (uid, title, body) => q('INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)', [uid, title, body || null]);
const pub = u => ({ id: u.id, full_name: u.full_name, phone: u.phone, role: u.role, level: u.level, member_code: u.member_code });

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try { req.user = jwt.verify(h.replace('Bearer ', ''), SECRET); next(); }
  catch { bad(res, 'نشست معتبر نیست', 401); }
}
// نقش از دیتابیس خوانده می‌شود تا توکن قدیمی بعد از تغییر نقش دسترسی ندهد
const admin = [auth, wrap(async (req, res, next) => {
  const [u] = await q('SELECT role FROM users WHERE id=$1', [req.user.id]);
  if (!u || u.role !== 'admin') return bad(res, 'دسترسی ندارید', 403);
  next();
})];

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- احراز هویت ----------
app.post('/api/register', wrap(async (req, res) => {
  const full_name = String(req.body.full_name || '').trim(), phone = digits(req.body.phone), password = String(req.body.password || '');
  if (!full_name) return bad(res, 'نام را وارد کنید');
  if (!validPhone(phone)) return bad(res, 'شماره همراه معتبر نیست (مثال: 09123456789)');
  if (password.length < 6) return bad(res, 'رمز عبور باید حداقل ۶ کاراکتر باشد');
  if ((await q('SELECT 1 FROM users WHERE phone=$1', [phone])).length) return bad(res, 'این شماره قبلاً ثبت‌نام کرده است', 409);
  const [u] = await q('INSERT INTO users(phone,password_hash,full_name) VALUES($1,$2,$3) RETURNING id', [phone, await bcrypt.hash(password, 10), full_name]);
  await q('UPDATE users SET member_code=$1 WHERE id=$2', [`S-${new Date().getFullYear()}-${String(u.id).padStart(4, '0')}`, u.id]);
  res.status(201).json({ ok: true });
}));
app.post('/api/login', wrap(async (req, res) => {
  const phone = digits(req.body.phone), password = String(req.body.password || '');
  const [u] = await q('SELECT * FROM users WHERE phone=$1', [phone]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return bad(res, 'شماره یا رمز عبور اشتباه است', 401);
  res.json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' }), user: pub(u) });
}));
app.get('/api/profile', auth, wrap(async (req, res) => {
  const [u] = await q('SELECT * FROM users WHERE id=$1', [req.user.id]);
  u ? res.json(pub(u)) : bad(res, 'کاربر یافت نشد', 401);
}));
app.put('/api/profile', auth, wrap(async (req, res) => {
  const name = String(req.body.full_name || '').trim();
  if (!name) return bad(res, 'نام را وارد کنید');
  const [u] = await q('UPDATE users SET full_name=$1 WHERE id=$2 RETURNING *', [name, req.user.id]);
  res.json(pub(u));
}));

// ---------- محتوای عمومی (فقط نمایش) ----------
app.get('/api/menu', auth, wrap(async (req, res) => res.json(await q('SELECT * FROM cafe_items WHERE active ORDER BY sort,id'))));
app.get('/api/books', auth, wrap(async (req, res) => res.json(await q('SELECT * FROM books WHERE active ORDER BY id DESC'))));
app.get('/api/art', auth, wrap(async (req, res) => res.json(await q('SELECT * FROM art_products WHERE active ORDER BY id DESC'))));
app.get('/api/events', auth, wrap(async (req, res) => res.json(await q(
  `SELECT e.*, (SELECT count(*)::int FROM event_registrations r WHERE r.event_id=e.id) AS registered,
   EXISTS(SELECT 1 FROM event_registrations r WHERE r.event_id=e.id AND r.user_id=$1) AS mine
   FROM events e WHERE e.active ORDER BY e.event_date`, [req.user.id]))));

// ---------- رویدادها ----------
app.post('/api/events/:id/register', auth, wrap(async (req, res) => {
  const [e] = await q('SELECT *, (SELECT count(*)::int FROM event_registrations WHERE event_id=events.id) AS n FROM events WHERE id=$1 AND active', [req.params.id]);
  if (!e) return bad(res, 'رویداد یافت نشد', 404);
  if (!e.registration_open) return bad(res, 'ثبت‌نام این رویداد بسته است');
  if (e.capacity && e.n >= e.capacity) return bad(res, 'ظرفیت رویداد تکمیل است');
  await q('INSERT INTO event_registrations(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [e.id, req.user.id]);
  await notify(req.user.id, 'ثبت‌نام رویداد', `ثبت‌نام شما در «${e.title}» انجام شد.`);
  res.json({ ok: true });
}));
app.delete('/api/events/:id/register', auth, wrap(async (req, res) => {
  await q('DELETE FROM event_registrations WHERE event_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

// ---------- امانت (مدل نسخهٔ ۱، جدا از فروش و سبد) ----------
app.post('/api/loan-requests', auth, wrap(async (req, res) => {
  const [b] = await q("SELECT * FROM books WHERE id=$1 AND active AND type='loan'", [req.body.book_id]);
  if (!b) return bad(res, 'کتاب امانی یافت نشد', 404);
  if (b.status !== 'available') return bad(res, 'این کتاب در حال حاضر امانت داده شده است');
  if ((await q("SELECT 1 FROM loan_requests WHERE user_id=$1 AND book_id=$2 AND status='pending'", [req.user.id, b.id])).length) return bad(res, 'درخواست قبلی شما در حال بررسی است');
  await q('INSERT INTO loan_requests(user_id,book_id) VALUES($1,$2)', [req.user.id, b.id]);
  res.status(201).json({ ok: true });
}));
app.get('/api/loan-requests/my', auth, wrap(async (req, res) => res.json(await q(
  'SELECT l.*, b.title AS book_title FROM loan_requests l JOIN books b ON b.id=l.book_id WHERE l.user_id=$1 ORDER BY l.id DESC', [req.user.id]))));

// ---------- درخواست/پیشنهاد کتاب ----------
app.post('/api/book-requests', auth, wrap(async (req, res) => {
  const t = String(req.body.book_title || '').trim();
  if (!t) return bad(res, 'عنوان کتاب الزامی است');
  await q('INSERT INTO book_requests(user_id,book_title,author,description) VALUES($1,$2,$3,$4)',
    [req.user.id, t, req.body.author || null, req.body.description || null]);
  res.status(201).json({ ok: true });
}));
app.get('/api/book-requests/my', auth, wrap(async (req, res) => res.json(await q('SELECT * FROM book_requests WHERE user_id=$1 ORDER BY id DESC', [req.user.id]))));

// ---------- سبد مشترک ← درخواست خرید (بدون پرداخت آنلاین) ----------
app.post('/api/purchase-requests', auth, wrap(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  const phone = digits(req.body.contact_phone);
  if (!items.length) return bad(res, 'سبد خرید خالی است');
  if (!validPhone(phone)) return bad(res, 'شمارهٔ تماس معتبر نیست');
  const rows = [];
  for (const it of items) {
    const qty = Math.min(Math.max(parseInt(it.qty) || 1, 1), 99);
    const [r] = it.type === 'book'
      ? await q("SELECT id,title,price FROM books WHERE id=$1 AND active AND type='sale'", [it.id])
      : await q("SELECT id,name AS title,price FROM art_products WHERE id=$1 AND active AND stock_status<>'out'", [it.id]);
    if (!r) return bad(res, 'یکی از اقلام سبد دیگر در دسترس نیست؛ سبد را بازبینی کنید');
    rows.push({ type: it.type === 'book' ? 'book' : 'art', ...r, qty, note: String(it.note || '').slice(0, 500) || null });
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [pr] } = await c.query('INSERT INTO purchase_requests(user_id,contact_phone,note) VALUES($1,$2,$3) RETURNING id', [req.user.id, phone, String(req.body.note || '').slice(0, 1000) || null]);
    for (const r of rows) await c.query('INSERT INTO purchase_request_items(request_id,item_type,item_id,title,price,qty,note) VALUES($1,$2,$3,$4,$5,$6,$7)', [pr.id, r.type, r.id, r.title, r.price, r.qty, r.note]);
    await c.query('COMMIT');
    await notify(req.user.id, 'درخواست خرید ثبت شد', `درخواست شمارهٔ ${pr.id} ثبت شد. مدیریت برای هماهنگی با شما تماس می‌گیرد.`);
    res.status(201).json({ id: pr.id });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));
const withItems = async rows => {
  if (!rows.length) return rows;
  const items = await q('SELECT * FROM purchase_request_items WHERE request_id = ANY($1) ORDER BY id', [rows.map(r => r.id)]);
  return rows.map(r => ({ ...r, items: items.filter(i => i.request_id === r.id) }));
};
app.get('/api/purchase-requests/my', auth, wrap(async (req, res) =>
  res.json(await withItems(await q('SELECT * FROM purchase_requests WHERE user_id=$1 ORDER BY id DESC', [req.user.id])))));

// ---------- اعلان‌ها ----------
app.get('/api/notifications', auth, wrap(async (req, res) => res.json(await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [req.user.id]))));
app.put('/api/notifications/read', auth, wrap(async (req, res) => { await q('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user.id]); res.json({ ok: true }); }));

// ---------- پنل مدیریت ----------
const RES = {
  menu: { t: 'cafe_items', f: ['category', 'name', 'description', 'price', 'image_url', 'sort', 'active'] },
  books: { t: 'books', f: ['title', 'author', 'description', 'category', 'type', 'price', 'status', 'image_url', 'active'] },
  art: { t: 'art_products', f: ['category', 'name', 'description', 'price', 'image_url', 'stock_status', 'allow_custom', 'active'] },
  events: { t: 'events', f: ['title', 'description', 'event_date', 'location', 'capacity', 'registration_open', 'image_url', 'active'] },
};
const pick = (r, body) => {
  const cols = r.f.filter(k => k in body);
  return { cols, vals: cols.map(k => body[k] === '' ? null : body[k]) };
};
app.get('/api/admin/:res(menu|books|art|events)', admin, wrap(async (req, res) =>
  res.json(await q(`SELECT * FROM ${RES[req.params.res].t} ORDER BY id DESC`))));
app.post('/api/admin/:res(menu|books|art|events)', admin, wrap(async (req, res) => {
  const r = RES[req.params.res], { cols, vals } = pick(r, req.body);
  if (!cols.length) return bad(res, 'اطلاعاتی ارسال نشده');
  try {
    const [row] = await q(`INSERT INTO ${r.t}(${cols.join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals);
    res.status(201).json(row);
  } catch (e) { bad(res, 'اطلاعات واردشده معتبر نیست (فیلدهای الزامی را بررسی کنید)'); }
}));
app.put('/api/admin/:res(menu|books|art|events)/:id', admin, wrap(async (req, res) => {
  const r = RES[req.params.res], { cols, vals } = pick(r, req.body);
  if (!cols.length) return bad(res, 'اطلاعاتی ارسال نشده');
  try {
    const [row] = await q(`UPDATE ${r.t} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`, [...vals, req.params.id]);
    row ? res.json(row) : bad(res, 'یافت نشد', 404);
  } catch (e) { bad(res, 'اطلاعات واردشده معتبر نیست'); }
}));
app.delete('/api/admin/:res(menu|books|art|events)/:id', admin, wrap(async (req, res) => {
  await q(`UPDATE ${RES[req.params.res].t} SET active=false WHERE id=$1`, [req.params.id]); // غیرفعال‌سازی، نه حذف
  res.json({ ok: true });
}));
app.get('/api/admin/events/:id/registrations', admin, wrap(async (req, res) => res.json(await q(
  'SELECT u.full_name,u.phone,r.created_at FROM event_registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=$1 ORDER BY r.id', [req.params.id]))));

const PSTATUS = ['registered', 'reviewing', 'confirmed', 'awaiting_contact', 'ready', 'shipped', 'completed', 'cancelled'];
const PLABEL = { registered: 'ثبت‌شده', reviewing: 'در حال بررسی', confirmed: 'تأییدشده', awaiting_contact: 'در انتظار هماهنگی', ready: 'آماده تحویل', shipped: 'ارسال‌شده', completed: 'تکمیل‌شده', cancelled: 'ردشده یا لغوشده' };
app.get('/api/admin/purchase-requests', admin, wrap(async (req, res) => res.json(await withItems(await q(
  'SELECT p.*,u.full_name,u.phone FROM purchase_requests p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200')))));
app.put('/api/admin/purchase-requests/:id', admin, wrap(async (req, res) => {
  const { status, admin_note, final_price } = req.body;
  if (status && !PSTATUS.includes(status)) return bad(res, 'وضعیت نامعتبر است');
  const [p] = await q('UPDATE purchase_requests SET status=COALESCE($1,status), admin_note=COALESCE($2,admin_note), final_price=COALESCE($3,final_price) WHERE id=$4 RETURNING *',
    [status || null, admin_note ?? null, final_price === '' ? null : final_price ?? null, req.params.id]);
  if (!p) return bad(res, 'یافت نشد', 404);
  if (status) await notify(p.user_id, 'تغییر وضعیت درخواست خرید', `درخواست شمارهٔ ${p.id}: ${PLABEL[status]}`);
  res.json(p);
}));
app.get('/api/admin/loan-requests', admin, wrap(async (req, res) => res.json(await q(
  `SELECT l.*,b.title AS book_title,u.full_name,u.phone FROM loan_requests l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 200`))));
app.put('/api/admin/loan-requests/:id', admin, wrap(async (req, res) => {
  const st = req.body.status;
  if (!['approved', 'rejected'].includes(st)) return bad(res, 'وضعیت نامعتبر است');
  const [l] = await q('UPDATE loan_requests SET status=$1 WHERE id=$2 AND status=$3 RETURNING *', [st, req.params.id, 'pending']);
  if (!l) return bad(res, 'این درخواست قبلاً بررسی شده است', 409);
  if (st === 'approved') await q("UPDATE books SET status='loaned' WHERE id=$1", [l.book_id]);
  await notify(l.user_id, 'درخواست امانت', st === 'approved' ? 'درخواست امانت شما تأیید شد.' : 'درخواست امانت شما رد شد.');
  res.json(l);
}));
app.put('/api/admin/books/:id/return', admin, wrap(async (req, res) => { await q("UPDATE books SET status='available' WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));
app.get('/api/admin/book-requests', admin, wrap(async (req, res) => res.json(await q(
  'SELECT r.*,u.full_name,u.phone FROM book_requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 200'))));
app.put('/api/admin/book-requests/:id', admin, wrap(async (req, res) => {
  const { status, admin_note } = req.body;
  if (status && !['pending', 'approved', 'rejected'].includes(status)) return bad(res, 'وضعیت نامعتبر است');
  const [r] = await q('UPDATE book_requests SET status=COALESCE($1,status), admin_note=COALESCE($2,admin_note) WHERE id=$3 RETURNING *', [status || null, admin_note ?? null, req.params.id]);
  if (!r) return bad(res, 'یافت نشد', 404);
  if (status && status !== 'pending') await notify(r.user_id, 'درخواست کتاب', `نتیجهٔ بررسی «${r.book_title}»: ${status === 'approved' ? 'تأیید شد' : 'رد شد'}`);
  res.json(r);
}));

// فرانت‌اند (حالت وب) از همین سرور سرو می‌شود
const www = path.join(__dirname, '..', 'www');
if (fs.existsSync(www)) app.use(express.static(www));

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const ap = digits(process.env.ADMIN_PHONE), pw = process.env.ADMIN_PASSWORD;
  if (validPhone(ap) && pw && !(await q('SELECT 1 FROM users WHERE phone=$1', [ap])).length) {
    const [u] = await q("INSERT INTO users(phone,password_hash,full_name,role) VALUES($1,$2,'مدیر سیمرغ','admin') RETURNING id", [ap, await bcrypt.hash(pw, 10)]);
    await q('UPDATE users SET member_code=$1 WHERE id=$2', [`S-${new Date().getFullYear()}-${String(u.id).padStart(4, '0')}`, u.id]);
    console.log('مدیر اولیه ساخته شد');
  }
  app.listen(process.env.PORT || 3000, () => console.log('API آماده است'));
})().catch(e => { console.error('خطا در راه‌اندازی:', e.message); process.exit(1); });
