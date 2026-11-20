CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', level TEXT NOT NULL DEFAULT 'bronze',
  member_code TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS cafe_items(
  id SERIAL PRIMARY KEY, category TEXT, name TEXT NOT NULL, description TEXT, price NUMERIC,
  image_url TEXT, sort INT DEFAULT 0, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS books(
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, author TEXT, description TEXT, category TEXT,
  type TEXT NOT NULL DEFAULT 'loan' CHECK (type IN ('loan','sale')), price NUMERIC,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','loaned')),
  image_url TEXT, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS art_products(
  id SERIAL PRIMARY KEY, category TEXT, name TEXT NOT NULL, description TEXT, price NUMERIC,
  image_url TEXT, stock_status TEXT NOT NULL DEFAULT 'in_stock' CHECK (stock_status IN ('in_stock','made_to_order','out')),
  allow_custom BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS events(
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, event_date TIMESTAMPTZ, location TEXT,
  capacity INT, registration_open BOOLEAN DEFAULT true, image_url TEXT, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS event_registrations(
  id SERIAL PRIMARY KEY, event_id INT REFERENCES events(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id,user_id));
-- امانت: مطابق مدل نسخهٔ ۱ (درخواست ← تأیید مدیر ← امانت‌گرفته‌شده ← بازگشت)
CREATE TABLE IF NOT EXISTS loan_requests(
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE,
  book_id INT REFERENCES books(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT now());
-- درخواست/پیشنهاد کتاب (مسیر مستقل)
CREATE TABLE IF NOT EXISTS book_requests(
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'suggest', book_title TEXT NOT NULL, author TEXT, description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note TEXT, created_at TIMESTAMPTZ DEFAULT now());
-- سبد مشترک: درخواست خرید (بدون پرداخت آنلاین)
CREATE TABLE IF NOT EXISTS purchase_requests(
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL, note TEXT, admin_note TEXT, final_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'registered', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS purchase_request_items(
  id SERIAL PRIMARY KEY, request_id INT REFERENCES purchase_requests(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('book','art')), item_id INT NOT NULL,
  title TEXT NOT NULL, price NUMERIC, qty INT NOT NULL DEFAULT 1, note TEXT);
CREATE TABLE IF NOT EXISTS notifications(
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
