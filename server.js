'use strict';
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ========== تنظیمات ==========
const isProd = process.env.NODE_ENV === 'production';

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
    if (isProd) {
        console.error('❌ JWT_SECRET تنظیم نشده یا خیلی کوتاه است (حداقل ۱۶ کاراکتر). سرور بالا نمی‌آید.');
        process.exit(1);
    }
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️ JWT_SECRET تنظیم نشده؛ یک کلید موقت ساخته شد (با هر ری‌استارت همه لاگین‌ها باطل می‌شوند).');
}

if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL تنظیم نشده است.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
pool.on('error', (e) => console.error('❌ pg pool:', e.message));

const LEVELS = [
    { name: 'bronze',   min: 0,   discount: 0  },
    { name: 'silver',   min: 100, discount: 5  },
    { name: 'gold',     min: 300, discount: 10 },
    { name: 'platinum', min: 600, discount: 15 },
];
const POINTS = {
    LOAN_APPROVED: 20,
    BOOK_REQUEST_APPROVED: 15,
    EVENT_REGISTER: 10,
};

// ========== ابزارها ==========
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function levelFor(points) {
    let result = LEVELS[0];
    for (const l of LEVELS) if (points >= l.min) result = l;
    return result;
}

// تبدیل ارقام فارسی/عربی به انگلیسی
function toLatinDigits(s) {
    return String(s ?? '')
        .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
        .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function parseId(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(400, 'شناسه نامعتبر است');
    return n;
}

function cleanStr(v, max, { required = false, label = 'فیلد' } = {}) {
    const s = v == null ? '' : String(v).trim();
    if (required && !s) throw new HttpError(400, `${label} الزامی است`);
    if (s.length > max) throw new HttpError(400, `${label} حداکثر ${max} کاراکتر می‌تواند باشد`);
    return s || null;
}

function cleanPrice(v, label = 'قیمت') {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 1e12) throw new HttpError(400, `${label} باید عددی مثبت باشد`);
    return Math.round(n);
}

function cleanDate(v) {
    const d = new Date(v);
    if (!v || Number.isNaN(d.getTime())) throw new HttpError(400, 'تاریخ نامعتبر است');
    return d.toISOString();
}

async function withTx(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw e;
    } finally {
        client.release();
    }
}

// امتیاز: ردیف کاربر قفل می‌شود تا هم‌زمانی امتیازها را گم نکند.
// once=true یعنی برای همان reason فقط یک‌بار امتیاز داده شود (جلوگیری از سوءاستفاده).
async function addPoints(client, userId, amount, reason, { once = false } = {}) {
    const cur = await client.query('SELECT points FROM user_points WHERE user_id = $1 FOR UPDATE', [userId]);

    if (once) {
        const dup = await client.query(
            'SELECT 1 FROM points_log WHERE user_id = $1 AND reason = $2 LIMIT 1',
            [userId, reason]
        );
        if (dup.rows.length > 0) return null;
    }

    const newPoints = (cur.rows[0]?.points || 0) + amount;
    const lvl = levelFor(newPoints);

    if (cur.rows.length === 0) {
        await client.query(
            'INSERT INTO user_points (user_id, points, level) VALUES ($1, $2, $3)',
            [userId, newPoints, lvl.name]
        );
    } else {
        await client.query(
            'UPDATE user_points SET points = $1, level = $2 WHERE user_id = $3',
            [newPoints, lvl.name, userId]
        );
    }
    await client.query(
        'UPDATE simorgh_cards SET discount_percent = $1 WHERE user_id = $2',
        [lvl.discount, userId]
    );
    await client.query(
        'INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, $3)',
        [userId, amount, reason]
    );
    return { points: newPoints, level: lvl.name, discount: lvl.discount };
}

async function createCard(client, userId) {
    for (let i = 0; i < 5; i++) {
        const cardNumber = 'SIM-' + crypto.randomInt(10000000, 100000000);
        await client.query('SAVEPOINT card_try');
        try {
            await client.query(
                'INSERT INTO simorgh_cards (user_id, card_number, discount_percent) VALUES ($1,$2,0)',
                [userId, cardNumber]
            );
            await client.query('RELEASE SAVEPOINT card_try');
            return cardNumber;
        } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT card_try');
            if (e.code !== '23505') throw e; // فقط تکراری بودن شماره کارت دوباره تلاش می‌شود
        }
    }
    throw new HttpError(500, 'ساخت کارت ناموفق بود، دوباره تلاش کن');
}

// ========== میان‌افزارها ==========
const app = express();
app.set('trust proxy', 1); // پشت پروکسی میزبان (برای rate limit درست)
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

const corsOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(corsOrigins.includes('*') ? {} : { origin: corsOrigins }));
app.use(express.json({ limit: '100kb' }));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تلاش‌های زیاد؛ چند دقیقه بعد دوباره امتحان کن' },
});

const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'دسترسی غیرمجاز' });
    try {
        req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        next();
    } catch {
        res.status(401).json({ error: 'توکن نامعتبر است' });
    }
};

// نقش از دیتابیس خوانده می‌شود، نه از توکن (تا ادمین حذف‌شده فوراً دسترسی‌اش را از دست بدهد)
const requireAdmin = asyncHandler(async (req, res, next) => {
    const r = await pool.query('SELECT role FROM profiles WHERE id = $1', [req.user.id]);
    if (r.rows[0]?.role !== 'admin') throw new HttpError(403, 'فقط ادمین دسترسی دارد');
    next();
});
const adminOnly = [authenticateToken, requireAdmin];

// ========== سلامت ==========
app.get('/api/health', asyncHandler(async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
}));

// ========== احراز هویت ==========
app.post('/api/register', authLimiter, asyncHandler(async (req, res) => {
    const username = toLatinDigits(req.body.username).trim();
    const password = String(req.body.password ?? '');
    const full_name = cleanStr(req.body.full_name, 100) || '';

    if (!username || !password) throw new HttpError(400, 'شماره تماس و رمز الزامی است');
    if (!/^09\d{9}$/.test(username)) throw new HttpError(400, 'شماره تماس نامعتبر است (مثال: 09123456789)');
    if (password.length < 6) throw new HttpError(400, 'رمز باید حداقل ۶ کاراکتر باشد');
    if (password.length > 72) throw new HttpError(400, 'رمز حداکثر ۷۲ کاراکتر می‌تواند باشد');

    const exists = await pool.query('SELECT id FROM profiles WHERE username = $1', [username]);
    if (exists.rows.length > 0) throw new HttpError(400, 'این شماره قبلاً ثبت شده است');

    const hash = await bcrypt.hash(password, 10);
    try {
        const user = await withTx(async (client) => {
            const r = await client.query(
                'INSERT INTO profiles (username, password_hash, full_name) VALUES ($1,$2,$3) RETURNING id, username, full_name, role',
                [username, hash, full_name]
            );
            const u = r.rows[0];
            await client.query('INSERT INTO user_points (user_id, points, level) VALUES ($1, 0, $2)', [u.id, 'bronze']);
            await createCard(client, u.id);
            return u;
        });
        res.status(201).json({ message: 'ثبت‌نام موفق', user });
    } catch (e) {
        if (e.code === '23505') throw new HttpError(400, 'این شماره قبلاً ثبت شده است');
        throw e;
    }
}));

app.post('/api/login', authLimiter, asyncHandler(async (req, res) => {
    const username = toLatinDigits(req.body.username).trim();
    const password = String(req.body.password ?? '');
    if (!username || !password) throw new HttpError(400, 'شماره تماس و رمز الزامی است');

    const result = await pool.query('SELECT * FROM profiles WHERE username = $1', [username]);
    const user = result.rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!valid) throw new HttpError(401, 'شماره یا رمز اشتباه است');

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '2d' }
    );
    res.json({
        message: 'ورود موفق',
        token,
        user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    });
}));

app.get('/api/profile', authenticateToken, asyncHandler(async (req, res) => {
    const [user, points, card] = await Promise.all([
        pool.query('SELECT id, username, full_name, role FROM profiles WHERE id = $1', [req.user.id]),
        pool.query('SELECT points, level FROM user_points WHERE user_id = $1', [req.user.id]),
        pool.query('SELECT card_number, discount_percent FROM simorgh_cards WHERE user_id = $1', [req.user.id]),
    ]);
    if (user.rows.length === 0) throw new HttpError(401, 'کاربر یافت نشد');
    res.json({
        user: user.rows[0],
        points: points.rows[0] || { points: 0, level: 'bronze' },
        card: card.rows[0] || { card_number: '---', discount_percent: 0 },
    });
}));

app.get('/api/points/history', authenticateToken, asyncHandler(async (req, res) => {
    const r = await pool.query(
        'SELECT amount, reason, created_at FROM points_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
        [req.user.id]
    );
    res.json(r.rows);
}));

// ========== منوی کافه ==========
app.get('/api/menu', asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM menu_items ORDER BY category, name');
    res.json(r.rows);
}));

app.post('/api/menu', adminOnly, asyncHandler(async (req, res) => {
    const name = cleanStr(req.body.name, 150, { required: true, label: 'نام' });
    const price = cleanPrice(req.body.price);
    const category = cleanStr(req.body.category, 100, { label: 'دسته‌بندی' });
    const description = cleanStr(req.body.description, 1000, { label: 'توضیحات' });
    const r = await pool.query(
        'INSERT INTO menu_items (name, price, category, description) VALUES ($1,$2,$3,$4) RETURNING *',
        [name, price, category, description]
    );
    res.status(201).json(r.rows[0]);
}));

app.put('/api/menu/:id', adminOnly, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const name = cleanStr(req.body.name, 150, { required: true, label: 'نام' });
    const price = cleanPrice(req.body.price);
    const category = cleanStr(req.body.category, 100, { label: 'دسته‌بندی' });
    const description = cleanStr(req.body.description, 1000, { label: 'توضیحات' });
    const r = await pool.query(
        'UPDATE menu_items SET name=$1, price=$2, category=$3, description=$4 WHERE id=$5 RETURNING *',
        [name, price, category, description, id]
    );
    if (r.rows.length === 0) throw new HttpError(404, 'یافت نشد');
    res.json(r.rows[0]);
}));

app.delete('/api/menu/:id', adminOnly, asyncHandler(async (req, res) => {
    const r = await pool.query('DELETE FROM menu_items WHERE id=$1', [parseId(req.params.id)]);
    if (r.rowCount === 0) throw new HttpError(404, 'یافت نشد');
    res.json({ message: 'حذف شد' });
}));

// ========== کتاب‌ها ==========
function readBookBody(body) {
    const title = cleanStr(body.title, 200, { required: true, label: 'عنوان' });
    const author = cleanStr(body.author, 150, { label: 'نویسنده' });
    const description = cleanStr(body.description, 2000, { label: 'توضیحات' });
    const type = body.type;
    if (!['loan', 'sale'].includes(type)) throw new HttpError(400, 'نوع باید loan یا sale باشد');
    const price = type === 'sale' ? cleanPrice(body.price, 'قیمت کتاب فروشی') : null;
    return { title, author, type, price, description };
}

app.get('/api/books', asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM books ORDER BY created_at DESC');
    res.json(r.rows);
}));

app.post('/api/books', adminOnly, asyncHandler(async (req, res) => {
    const b = readBookBody(req.body);
    const r = await pool.query(
        'INSERT INTO books (title, author, type, price, description, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [b.title, b.author, b.type, b.price, b.description, 'available']
    );
    res.status(201).json(r.rows[0]);
}));

app.put('/api/books/:id', adminOnly, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const b = readBookBody(req.body);
    const r = await pool.query(
        'UPDATE books SET title=$1, author=$2, type=$3, price=$4, description=$5 WHERE id=$6 RETURNING *',
        [b.title, b.author, b.type, b.price, b.description, id]
    );
    if (r.rows.length === 0) throw new HttpError(404, 'یافت نشد');
    res.json(r.rows[0]);
}));

// برگشت کتاب امانی (قبلاً هیچ راهی برای برگرداندن وضعیت «امانت داده شده» نبود)
app.put('/api/books/:id/return', adminOnly, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const r = await pool.query(
        "UPDATE books SET status='available' WHERE id=$1 AND status='loaned' RETURNING *",
        [id]
    );
    if (r.rows.length === 0) throw new HttpError(400, 'این کتاب در وضعیت امانت نیست');
    res.json(r.rows[0]);
}));

app.delete('/api/books/:id', adminOnly, asyncHandler(async (req, res) => {
    const r = await pool.query('DELETE FROM books WHERE id=$1', [parseId(req.params.id)]);
    if (r.rowCount === 0) throw new HttpError(404, 'یافت نشد');
    res.json({ message: 'حذف شد' });
}));

// ========== درخواست امانت ==========
app.post('/api/loan-requests', authenticateToken, asyncHandler(async (req, res) => {
    const book_id = parseId(req.body.book_id);
    const book = await pool.query('SELECT * FROM books WHERE id=$1 AND type=$2', [book_id, 'loan']);
    if (book.rows.length === 0) throw new HttpError(404, 'کتاب امانی یافت نشد');
    if (book.rows[0].status !== 'available') throw new HttpError(400, 'این کتاب در دسترس نیست');

    const dup = await pool.query(
        'SELECT id FROM loan_requests WHERE user_id=$1 AND book_id=$2 AND status=$3',
        [req.user.id, book_id, 'pending']
    );
    if (dup.rows.length > 0) throw new HttpError(400, 'درخواست قبلی شما در انتظار است');

    const r = await pool.query(
        'INSERT INTO loan_requests (user_id, book_id) VALUES ($1,$2) RETURNING *',
        [req.user.id, book_id]
    );
    res.status(201).json(r.rows[0]);
}));

app.get('/api/loan-requests/my', authenticateToken, asyncHandler(async (req, res) => {
    const r = await pool.query(
        `SELECT lr.*, b.title AS book_title FROM loan_requests lr
         JOIN books b ON lr.book_id = b.id
         WHERE lr.user_id = $1 ORDER BY lr.requested_at DESC`,
        [req.user.id]
    );
    res.json(r.rows);
}));

app.get('/api/loan-requests', adminOnly, asyncHandler(async (req, res) => {
    const r = await pool.query(
        `SELECT lr.*, b.title AS book_title, p.full_name AS user_name
         FROM loan_requests lr
         JOIN books b ON lr.book_id = b.id
         JOIN profiles p ON lr.user_id = p.id
         ORDER BY lr.requested_at DESC`
    );
    res.json(r.rows);
}));

app.put('/api/loan-requests/:id', adminOnly, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) throw new HttpError(400, 'وضعیت نامعتبر');

    await withTx(async (client) => {
        const lr = await client.query('SELECT * FROM loan_requests WHERE id=$1 FOR UPDATE', [id]);
        if (lr.rows.length === 0) throw new HttpError(404, 'یافت نشد');
        const request = lr.rows[0];
        if (request.status !== 'pending') throw new HttpError(400, 'این درخواست قبلاً بررسی شده');

        if (status === 'approved') {
            // قفل کتاب: دو درخواست هم‌زمان برای یک کتاب نباید هر دو تأیید شوند
            const book = await client.query('SELECT status FROM books WHERE id=$1 FOR UPDATE', [request.book_id]);
            if (book.rows.length === 0) throw new HttpError(404, 'کتاب یافت نشد');
            if (book.rows[0].status !== 'available') throw new HttpError(400, 'این کتاب دیگر در دسترس نیست');

            await client.query('UPDATE loan_requests SET status=$1 WHERE id=$2', ['approved', id]);
            await client.query('UPDATE books SET status=$1 WHERE id=$2', ['loaned', request.book_id]);
            await client.query(
                "UPDATE loan_requests SET status='rejected' WHERE book_id=$1 AND status='pending' AND id<>$2",
                [request.book_id, id]
            );
            await addPoints(client, request.user_id, POINTS.LOAN_APPROVED, `loan_approved:${id}`, { once: true });
        } else {
            await client.query('UPDATE loan_requests SET status=$1 WHERE id=$2', ['rejected', id]);
        }
    });
    res.json({ message: 'به‌روزرسانی شد' });
}));

// ========== درخواست کتاب ==========
app.post('/api/book-requests', authenticateToken, asyncHandler(async (req, res) => {
    const request_type = req.body.request_type;
    if (!['bring_from_patio', 'donate_for_loan'].includes(request_type))
        throw new HttpError(400, 'نوع درخواست نامعتبر');
    const book_title = cleanStr(req.body.book_title, 200, { required: true, label: 'عنوان' });
    const author = cleanStr(req.body.author, 150, { label: 'نویسنده' });
    const description = cleanStr(req.body.description, 2000, { label: 'توضیحات' });
    const r = await pool.query(
        'INSERT INTO book_requests (user_id, request_type, book_title, author, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.id, request_type, book_title, author, description]
    );
    res.status(201).json(r.rows[0]);
}));

app.get('/api/book-requests/my', authenticateToken, asyncHandler(async (req, res) => {
    const r = await pool.query(
        'SELECT * FROM book_requests WHERE user_id=$1 ORDER BY created_at DESC',
        [req.user.id]
    );
    res.json(r.rows);
}));

app.get('/api/book-requests', adminOnly, asyncHandler(async (req, res) => {
    const r = await pool.query(
        `SELECT br.*, p.full_name AS user_name FROM book_requests br
         JOIN profiles p ON br.user_id = p.id ORDER BY br.created_at DESC`
    );
    res.json(r.rows);
}));

app.put('/api/book-requests/:id', adminOnly, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) throw new HttpError(400, 'وضعیت نامعتبر');

    await withTx(async (client) => {
        const br = await client.query('SELECT * FROM book_requests WHERE id=$1 FOR UPDATE', [id]);
        if (br.rows.length === 0) throw new HttpError(404, 'یافت نشد');
        if (br.rows[0].status !== 'pending') throw new HttpError(400, 'قبلاً بررسی شده');

        await client.query('UPDATE book_requests SET status=$1 WHERE id=$2', [status, id]);
        if (status === 'approved') {
            await addPoints(client, br.rows[0].user_id, POINTS.BOOK_REQUEST_APPROVED, `book_request:${id}`, { once: true });
        }
    });
    res.json({ message: 'به‌روزرسانی شد' });
}));

// ========== رویدادها ==========
function readEventBody(body) {
    const title = cleanStr(body.title, 200, { required: true, label: 'عنوان' });
    const description = cleanStr(body.description, 2000, { label: 'توضیحات' });
    const location = cleanStr(body.location, 200, { label: 'مکان' });
    const event_date = cleanDate(body.event_date);
    return { title, description, location, event_date };
}

app.get('/api/events', asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM events ORDER BY event_date ASC');
    res.json(r.rows);
}));

app.get('/api/events/my', authenticateToken, asyncHandler(async (req, res) => {
    const r = await pool.query(
        `SELECT e.*, er.registered_at FROM event_registrations er
         JOIN events e ON er.event_id = e.id
         WHERE er.user_id = $1 ORDER BY e.event_date ASC`,
        [req.user.id]
    );
    res.json(r.rows);
}));

app.post('/api/events', adminOnly, asyncHandler(async (req, res) => {
    const e = readEventBody(req.body);
    const r = await pool.query(
        'INSERT INTO events (title, description, event_date, location) VALUES ($1,$2,$3,$4) RETURNING *',
        [e.title, e.description, e.event_date, e.location]
    );
    res.status(201).json(r.rows[0]);
}));

app.put('/api/events/:id', adminOnly, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const e = readEventBody(req.body);
    const r = await pool.query(
        'UPDATE events SET title=$1, description=$2, event_date=$3, location=$4 WHERE id=$5 RETURNING *',
        [e.title, e.description, e.event_date, e.location, id]
    );
    if (r.rows.length === 0) throw new HttpError(404, 'یافت نشد');
    res.json(r.rows[0]);
}));

app.delete('/api/events/:id', adminOnly, asyncHandler(async (req, res) => {
    const r = await pool.query('DELETE FROM events WHERE id=$1', [parseId(req.params.id)]);
    if (r.rowCount === 0) throw new HttpError(404, 'یافت نشد');
    res.json({ message: 'حذف شد' });
}));

app.post('/api/events/register/:id', authenticateToken, asyncHandler(async (req, res) => {
    const eventId = parseId(req.params.id);
    await withTx(async (client) => {
        const ev = await client.query('SELECT event_date FROM events WHERE id=$1', [eventId]);
        if (ev.rows.length === 0) throw new HttpError(404, 'رویداد یافت نشد');
        if (new Date(ev.rows[0].event_date) < new Date()) throw new HttpError(400, 'این رویداد برگزار شده است');

        try {
            await client.query(
                'INSERT INTO event_registrations (user_id, event_id) VALUES ($1,$2)',
                [req.user.id, eventId]
            );
        } catch (err) {
            if (err.code === '23505') throw new HttpError(400, 'قبلاً ثبت‌نام کردی');
            throw err;
        }
        // با ثبت‌نام/لغو/ثبت‌نام دوباره نمی‌شود امتیاز تکراری گرفت
        await addPoints(client, req.user.id, POINTS.EVENT_REGISTER, `event:${eventId}`, { once: true });
    });
    res.json({ message: 'ثبت‌نام شد' });
}));

app.delete('/api/events/unregister/:id', authenticateToken, asyncHandler(async (req, res) => {
    const r = await pool.query(
        'DELETE FROM event_registrations WHERE user_id=$1 AND event_id=$2 RETURNING id',
        [req.user.id, parseId(req.params.id)]
    );
    if (r.rows.length === 0) throw new HttpError(404, 'ثبت‌نامی یافت نشد');
    res.json({ message: 'لغو شد' });
}));

// ========== فایل‌های وب (اختیاری؛ اگر پوشه www کنار سرور باشد، همان‌جا سرو می‌شود) ==========
const webDir = path.join(__dirname, '..', 'www');
if (process.env.SERVE_WEB !== 'false' && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir));
}

// ========== خطاها ==========
app.use('/api', (req, res) => res.status(404).json({ error: 'مسیر یافت نشد' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'بدنه‌ی درخواست نامعتبر است' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'درخواست خیلی بزرگ است' });
    if (err.code === '23505') return res.status(409).json({ error: 'این مورد قبلاً وجود دارد' });
    if (err.code === '23503') return res.status(409).json({ error: 'این مورد به داده‌های دیگر وابسته است' });
    if (['22P02', '22007', '22008', '22003'].includes(err.code))
        return res.status(400).json({ error: 'ورودی نامعتبر است' });
    console.error('❌', err.message);
    res.status(500).json({ error: 'خطای سرور' });
});

// ========== راه‌اندازی ==========
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 سرور روی پورت ${PORT}`));

function shutdown() {
    console.log('خاموش شدن...');
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('❌ unhandledRejection:', e));
