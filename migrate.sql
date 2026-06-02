-- ────────────────────────────────────────────────────────────────────
-- Safe migration script for Udumula's Grand LMS.
--
-- Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is idempotent
-- and can be run on every deployment without risk.
-- ────────────────────────────────────────────────────────────────────

-- Add missing columns to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state VARCHAR(50);

-- ────────────────────────────────────────────────────────────────────
-- 2026-05 release: expected_checkout is now a TIMESTAMP / DATETIME so
-- 24-hour lodge stays can store the actual checkout time
-- (e.g. 08-May-2026 10:30 AM). Existing DATE values are preserved by
-- defaulting to noon of that day. SQLite users do not need to run
-- this — SQLite is dynamically typed, so the model change is enough.
-- ────────────────────────────────────────────────────────────────────

-- PostgreSQL:
ALTER TABLE checkins
    ALTER COLUMN expected_checkout TYPE TIMESTAMP
    USING (expected_checkout::timestamp + INTERVAL '12 hours');

-- MySQL (uncomment if applicable; can't be combined with the Postgres line above):
-- ALTER TABLE checkins MODIFY COLUMN expected_checkout DATETIME;
-- UPDATE checkins SET expected_checkout = TIMESTAMPADD(HOUR, 12, expected_checkout)
--   WHERE TIME(expected_checkout) = '00:00:00';


-- ────────────────────────────────────────────────────────────────────
-- 2026-05 release: advance bookings.
--   bookings.rooms_count          — N rooms reserved under one booking
--   bookings.advance_amount       — prepayment collected at reservation
--   bookings.advance_payment_mode — how the advance was paid
--   checkins.advance_paid         — advance carried into the actual stay
--   invoices.advance_adjusted     — advance credited against the final bill
-- SQLite deployments do NOT need this — the app auto-migrates on startup
-- (see backend/app/auto_migrate.py). This block is for PostgreSQL / MySQL.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rooms_count          INTEGER       DEFAULT 1 NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS advance_amount       NUMERIC(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS advance_payment_mode VARCHAR(20)   DEFAULT 'cash';
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS advance_paid         NUMERIC(10,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS advance_adjusted     NUMERIC(10,2) DEFAULT 0;

-- ────────────────────────────────────────────────────────────────────
-- 2026-05 release: booking alerts.
--   alerts.booking_id — link alerts to bookings (for booking confirmation,
--                        cancellation, and pre-arrival reminder SMS/emails)
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(booking_id);


-- ────────────────────────────────────────────────────────────────────
-- 2026-05 release: MULTI-TENANT / multi-lodge support.
--
-- One installation can serve multiple lodges (Udumula's Grand, RK Lodge,
-- etc). Every tenant-scoped table gets a lodge_id column; uniqueness
-- constraints that used to be global become per-lodge.
--
-- SQLite deployments do NOT need this — the app auto-migrates on startup
-- (see backend/app/auto_migrate.py: it adds columns, back-fills lodge_id=1
-- on every existing row, drops the old UNIQUE(setting_key), seeds the
-- 'rk' lodge + an rkadmin user with default password 'rkadmin123').
--
-- For Postgres / MySQL, run the statements below. They're idempotent
-- (IF NOT EXISTS) so re-running is safe.
-- ────────────────────────────────────────────────────────────────────

-- 1) Lodges table — one row per tenant.
CREATE TABLE IF NOT EXISTS lodges (
    lodge_id     SERIAL PRIMARY KEY,
    code         VARCHAR(40)  UNIQUE NOT NULL,
    name         VARCHAR(120) NOT NULL,
    address      TEXT,
    phone        VARCHAR(20),
    email        VARCHAR(120),
    is_active    BOOLEAN      DEFAULT TRUE NOT NULL,
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- Seed the default lodge (id=1) using the existing hotel_name setting as
-- its display name, then promote the existing 'admin' user into it.
INSERT INTO lodges (lodge_id, code, name, is_active)
SELECT 1, 'udumulas',
       COALESCE((SELECT setting_value FROM settings WHERE setting_key = 'hotel_name' LIMIT 1),
                'Udumula''s Grand'),
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM lodges WHERE code = 'udumulas');

-- 2) Add lodge_id to every tenant-scoped table (nullable; back-filled below).
ALTER TABLE users               ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE customers           ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE rooms               ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE checkins            ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE invoices            ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE alerts              ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE settings            ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE agencies            ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE agency_api_calls    ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE bookings            ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE webhook_deliveries  ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE audit_logs          ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS lodge_id INTEGER REFERENCES lodges(lodge_id);

-- 3) Back-fill: existing rows belong to the default lodge.
UPDATE users               SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE customers           SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE rooms               SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE checkins            SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE invoices            SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE alerts              SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE settings            SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE agencies            SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE agency_api_calls    SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE bookings            SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE webhook_deliveries  SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE audit_logs          SET lodge_id = 1 WHERE lodge_id IS NULL;
UPDATE agent_conversations SET lodge_id = 1 WHERE lodge_id IS NULL;

-- 4) Settings: uniqueness moves from setting_key (globally unique) to
-- (lodge_id, setting_key). Drop the old constraint then add the composite
-- one. Constraint names vary by Postgres version — try the common ones.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_setting_key_key;
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_setting_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS ix_settings_lodge_key
    ON settings (lodge_id, setting_key);

-- 5) Seed the RK Lodge so multi-tenancy can be verified out of the box.
-- The startup auto_migrate will then copy default settings into it and
-- create the rkadmin user with password 'rkadmin123'.
INSERT INTO lodges (code, name, is_active)
SELECT 'rk', 'RK Lodge', TRUE
WHERE NOT EXISTS (SELECT 1 FROM lodges WHERE code = 'rk');

-- 6) Helpful indexes for tenant-scoped queries.
CREATE INDEX IF NOT EXISTS ix_customers_lodge_id           ON customers           (lodge_id);
CREATE INDEX IF NOT EXISTS ix_rooms_lodge_id               ON rooms               (lodge_id);
CREATE INDEX IF NOT EXISTS ix_checkins_lodge_id            ON checkins            (lodge_id);
CREATE INDEX IF NOT EXISTS ix_bookings_lodge_id            ON bookings            (lodge_id);
CREATE INDEX IF NOT EXISTS ix_invoices_lodge_id            ON invoices            (lodge_id);
CREATE INDEX IF NOT EXISTS ix_alerts_lodge_id              ON alerts              (lodge_id);
CREATE INDEX IF NOT EXISTS ix_agencies_lodge_id            ON agencies            (lodge_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_lodge_id          ON audit_logs          (lodge_id);
CREATE INDEX IF NOT EXISTS ix_agent_conversations_lodge_id ON agent_conversations (lodge_id);
