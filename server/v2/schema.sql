-- Simorgh v2 schema. Idempotent; does not delete existing data.
CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, phone VARCHAR(20) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
 user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 display_name VARCHAR(100) NOT NULL DEFAULT '', bio VARCHAR(500) NOT NULL DEFAULT '',
 avatar_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS points_ledger (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 amount INTEGER NOT NULL, reason VARCHAR(160) NOT NULL, reference_type VARCHAR(40), reference_id BIGINT,
 idempotency_key VARCHAR(180) UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_points_ledger_user_created ON points_ledger(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS content_categories (
 id BIGSERIAL PRIMARY KEY, section VARCHAR(20) NOT NULL CHECK(section IN ('store','cafe','library')),
 name VARCHAR(100) NOT NULL, image_url TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(section,name)
);
CREATE TABLE IF NOT EXISTS store_products (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT REFERENCES content_categories(id) ON DELETE SET NULL,
 name VARCHAR(180) NOT NULL, description TEXT NOT NULL DEFAULT '', image_url TEXT,
 price BIGINT NOT NULL CHECK(price>=0), is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cafe_items (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT REFERENCES content_categories(id) ON DELETE SET NULL,
 name VARCHAR(180) NOT NULL, description TEXT NOT NULL DEFAULT '', image_url TEXT,
 price BIGINT NOT NULL CHECK(price>=0), is_available BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_requests (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
 item_type VARCHAR(20) NOT NULL CHECK(item_type IN ('store_product','book')), item_id BIGINT NOT NULL,
 quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity>0),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed','cancelled')),
 note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_user ON purchase_requests(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS books (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT REFERENCES content_categories(id) ON DELETE SET NULL,
 title VARCHAR(220) NOT NULL, author VARCHAR(180) NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
 image_url TEXT, book_type VARCHAR(12) NOT NULL CHECK(book_type IN ('loan','sale','both')),
 sale_price BIGINT CHECK(sale_price IS NULL OR sale_price>=0),
 loan_fee BIGINT NOT NULL DEFAULT 20000 CHECK(loan_fee>=20000),
 availability VARCHAR(20) NOT NULL DEFAULT 'available' CHECK(availability IN ('available','unavailable','archived')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS loan_requests (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), book_id BIGINT NOT NULL REFERENCES books(id),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','picked_up','returned','cancelled')),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_at TIMESTAMPTZ, actual_pickup_at TIMESTAMPTZ,
 due_at TIMESTAMPTZ, actual_return_at TIMESTAMPTZ, extension_count INTEGER NOT NULL DEFAULT 0 CHECK(extension_count BETWEEN 0 AND 1),
 fine_settled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_loan_per_user ON loan_requests(user_id) WHERE status IN ('approved','picked_up');
CREATE TABLE IF NOT EXISTS loan_extensions (
 id BIGSERIAL PRIMARY KEY, loan_request_id BIGINT NOT NULL REFERENCES loan_requests(id) ON DELETE CASCADE,
 requested_by BIGINT NOT NULL REFERENCES users(id), status VARCHAR(16) NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','approved','rejected')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS book_requests (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
 request_type VARCHAR(30) NOT NULL CHECK(request_type IN ('bring_from_store','donate_for_loan')),
 title VARCHAR(220) NOT NULL, author VARCHAR(180) NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
 status VARCHAR(20) NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
 id BIGSERIAL PRIMARY KEY, title VARCHAR(220) NOT NULL, description TEXT NOT NULL DEFAULT '', poster_url TEXT,
 event_date TIMESTAMPTZ NOT NULL, event_type VARCHAR(20) NOT NULL CHECK(event_type IN ('weekly_notice','registration')),
 capacity INTEGER CHECK(capacity IS NULL OR capacity>=0), required_teammates INTEGER NOT NULL DEFAULT 0 CHECK(required_teammates>=0),
 rules_text TEXT NOT NULL DEFAULT '', rules_version INTEGER NOT NULL DEFAULT 1, points_reward INTEGER NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','cancelled','completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS event_registrations (
 id BIGSERIAL PRIMARY KEY, event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, accepted_rules_version INTEGER NOT NULL,
 accepted_points INTEGER NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'registered'
 CHECK(status IN ('registered','cancelled','attended','absent')),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT now(), cancelled_at TIMESTAMPTZ, UNIQUE(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS event_attendees (
 id BIGSERIAL PRIMARY KEY, registration_id BIGINT NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
 full_name VARCHAR(160) NOT NULL, phone VARCHAR(20) NOT NULL, is_account_owner BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS forum_topics (
 id BIGSERIAL PRIMARY KEY, created_by BIGINT NOT NULL REFERENCES users(id), title VARCHAR(220) NOT NULL,
 body TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','removed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS forum_comments (
 id BIGSERIAL PRIMARY KEY, topic_id BIGINT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
 parent_comment_id BIGINT REFERENCES forum_comments(id) ON DELETE CASCADE, created_by BIGINT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','removed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_files (
 id BIGSERIAL PRIMARY KEY, uploaded_by BIGINT NOT NULL REFERENCES users(id), storage_key TEXT NOT NULL UNIQUE,
 public_url TEXT NOT NULL, mime_type VARCHAR(100) NOT NULL, byte_size BIGINT NOT NULL CHECK(byte_size>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title VARCHAR(180) NOT NULL, body TEXT NOT NULL, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS admin_audit_log (
 id BIGSERIAL PRIMARY KEY, admin_user_id BIGINT REFERENCES users(id), action VARCHAR(120) NOT NULL,
 entity_type VARCHAR(80) NOT NULL, entity_id BIGINT, details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
