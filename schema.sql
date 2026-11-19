-- ساخت جدول‌ها (اگر قبلاً دارید، IF NOT EXISTS چیزی را تغییر نمی‌دهد)
CREATE TABLE IF NOT EXISTS profiles (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(20) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     VARCHAR(100) DEFAULT '',
  role          VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_points (
  user_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  points  INTEGER NOT NULL DEFAULT 0,
  level   VARCHAR(20) NOT NULL DEFAULT 'bronze'
);

CREATE TABLE IF NOT EXISTS simorgh_cards (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_number      VARCHAR(20) UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS points_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  reason     VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_points_log_user ON points_log(user_id, reason);

CREATE TABLE IF NOT EXISTS menu_items (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  price       NUMERIC(12,0) NOT NULL CHECK (price > 0),
  category    VARCHAR(100),
  description TEXT
);

CREATE TABLE IF NOT EXISTS books (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  author      VARCHAR(150),
  type        VARCHAR(10) NOT NULL CHECK (type IN ('loan','sale')),
  price       NUMERIC(12,0),
  description TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'available',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_requests (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS book_requests (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_type VARCHAR(30) NOT NULL CHECK (request_type IN ('bring_from_patio','donate_for_loan')),
  book_title   VARCHAR(200) NOT NULL,
  author       VARCHAR(150),
  description  TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  event_date  TIMESTAMPTZ NOT NULL,
  location    VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS event_registrations (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);
