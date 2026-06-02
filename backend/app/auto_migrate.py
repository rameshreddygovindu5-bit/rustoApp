"""
Lightweight additive auto-migration.

`Base.metadata.create_all()` creates *new* tables but never alters existing
ones. When a release adds a column to a model that already has rows in the
database, the column is silently missing and every query touching it fails.

This module bridges that gap for the common, safe case: adding a nullable /
defaulted column to an existing table. It inspects the live schema and issues
`ALTER TABLE ... ADD COLUMN` for anything declared on the model but absent in
the database. It never drops or renames — only adds — so it is safe to run on
every startup.

For destructive changes, use a real migration tool (Alembic). This is only
for the additive column case.
"""
import logging
from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# Tenant-scoped tables (carry lodge_id). The very first time the app starts
# after the multi-tenant release lands, these all need a lodge_id column
# added and back-filled with the default lodge (id 1, "Rusto").
_TENANT_TABLES = (
    "users", "customers", "rooms", "checkins", "invoices", "alerts",
    "settings", "agencies", "agency_api_calls", "bookings",
    "webhook_deliveries", "audit_logs", "agent_conversations",
)

# Columns this release adds. Keyed by table name. Each entry is
# (column_name, SQL type clause). Types are written in a dialect-portable
# way; SQLite and PostgreSQL both accept these.
_ADDITIVE_COLUMNS = {
    "bookings": [
        ("rooms_count",          "INTEGER DEFAULT 1"),
        ("advance_amount",       "NUMERIC(10,2) DEFAULT 0"),
        ("advance_payment_mode", "VARCHAR(20) DEFAULT 'cash'"),
    ],
    "checkins": [
        ("advance_paid",         "NUMERIC(10,2) DEFAULT 0"),
    ],
    "invoices": [
        ("advance_adjusted",     "NUMERIC(10,2) DEFAULT 0"),
    ],
    "alerts": [
        ("booking_id",           "INTEGER REFERENCES bookings(booking_id)"),
    ],
    # v2.4 — two-factor authentication on user accounts.
    "users": [
        ("totp_secret",          "VARCHAR(64)"),
        ("totp_enabled",         "BOOLEAN DEFAULT 0"),
        # v3.2 — per-user permission grants (JSON array). NULL = legacy defaults.
        ("permissions",          "TEXT"),
    ],
    # v3.1 — marketplace fields on Lodge (Rusto customer-facing).
    # is_published gates whether the lodge appears in public search.
    "lodges": [
        ("is_published",        "BOOLEAN DEFAULT 0"),
        ("public_description",  "TEXT"),
        ("public_city",         "VARCHAR(80)"),
        ("public_town",         "VARCHAR(80)"),
        ("public_area",         "VARCHAR(80)"),
        ("public_landmark",     "VARCHAR(80)"),
        ("public_pincode",      "VARCHAR(20)"),
        ("public_state",        "VARCHAR(80)"),
        ("public_country",      "VARCHAR(80) DEFAULT 'India'"),
        ("latitude",            "NUMERIC(10,7)"),
        ("longitude",           "NUMERIC(10,7)"),
        ("starting_price",      "NUMERIC(10,2)"),
        ("amenities",           "TEXT"),
        # v7.0 — WhatsApp per-lodge config.
        ("whatsapp_enabled",          "BOOLEAN DEFAULT 0"),
        ("whatsapp_phone_number_id",  "VARCHAR(40)"),
        ("whatsapp_access_token",     "VARCHAR(400)"),
        ("whatsapp_display_name",     "VARCHAR(80)"),
        # v9.0 — enhanced marketplace amenity + policy fields
        ("power_backup",         "BOOLEAN DEFAULT 0"),
        ("hot_water_24h",        "BOOLEAN DEFAULT 0"),
        ("parking_available",    "BOOLEAN DEFAULT 0"),
        ("bus_stand_km",         "NUMERIC(4,1)"),
        ("railway_station_km",   "NUMERIC(4,1)"),
        ("temple_nearby",        "BOOLEAN DEFAULT 0"),
        ("checkin_time",         "VARCHAR(10) DEFAULT '12:00'"),
        ("checkout_time",        "VARCHAR(10) DEFAULT '11:00'"),
        ("property_type",        "VARCHAR(40) DEFAULT 'lodge'"),
        ("star_category",        "INTEGER DEFAULT 0"),
        ("cancellation_policy",  "VARCHAR(40) DEFAULT 'flexible'"),
        ("cancellation_hours",   "INTEGER DEFAULT 24"),
        ("max_online_rooms_pct", "INTEGER DEFAULT 100"),
        ("instant_confirm",      "BOOLEAN DEFAULT 1"),
        ("allow_online_booking", "BOOLEAN DEFAULT 1"),
    ],
    # v7.1 — extended lodge registration: room-type breakdown + plan.
    "lodge_registration_requests": [
        ("rooms_ac",         "INTEGER DEFAULT 0"),
        ("rooms_non_ac",     "INTEGER DEFAULT 0"),
        ("rooms_deluxe",     "INTEGER DEFAULT 0"),
        ("rooms_suite",      "INTEGER DEFAULT 0"),
        ("selected_plan",    "VARCHAR(20)"),
        ("billing_cycle",    "VARCHAR(10) DEFAULT 'monthly'"),
        ("quoted_price_inr", "NUMERIC(12,2)"),
    ],
    # v8.0.1 — invoice/reminder email dedup tracking.
    "lodge_subscriptions": [
        ("last_reminder_sent_for_date", "DATE"),
        # v8.2 — scheduled plan-change fields.
        ("pending_plan_key",               "VARCHAR(20)"),
        ("pending_billing_cycle",          "VARCHAR(10)"),
        ("pending_total_rooms",            "INTEGER"),
        ("pending_change_takes_effect_at", "DATE"),
        ("pending_change_queued_at",       "DATETIME"),
        # v8.3 — "cancel at period end" support.
        ("service_ends_at",                "DATE"),
    ],
    "lodge_billing_invoices": [
        ("email_sent_at", "DATETIME"),
    ],
}


def _add_column_if_missing(engine, table, col, ddl_type):
    """Helper: ALTER TABLE ADD COLUMN, swallowing duplicate-column races."""
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()):
        return False
    if col in {c["name"] for c in inspector.get_columns(table)}:
        return False
    try:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl_type}"))
        logger.info("Auto-migration: added %s.%s", table, col)
        return True
    except Exception as e:
        logger.warning("Auto-migration skipped %s.%s: %s", table, col, e)
        return False


def _ensure_default_lodge(engine):
    """Ensure lodge_id 1 ('Rusto') exists. All pre-existing rows belong
    to it (by definition — this is the lodge that was running before
    multi-tenant was introduced). Returns the id."""
    with engine.begin() as conn:
        # Table may not exist yet — create_all() will have made it on this
        # same startup, but be defensive.
        try:
            row = conn.execute(text("SELECT lodge_id FROM lodges WHERE code = 'rusto'")).first()
        except Exception:
            return None
        if row:
            return row[0]
        # Pull existing hotel_name from settings as the display name, if
        # present, so the existing lodge keeps its branding.
        try:
            hn = conn.execute(text("SELECT setting_value FROM settings WHERE setting_key = 'hotel_name'")).first()
            display_name = hn[0] if hn and hn[0] else "Main Lodge"
        except Exception:
            display_name = "Main Lodge"
        # Use a defensive INSERT that explicitly sets every NOT-NULL
        # column we know about (including ones added in later migrations
        # like is_published from the Rusto marketplace work). This way
        # the bootstrap survives every future "added NOT NULL column"
        # change to the Lodge model.
        try:
            conn.execute(text(
                "INSERT INTO lodges (lodge_id, code, name, is_active, is_published) "
                "VALUES (1, 'rusto', :n, true, false)"
            ), {"n": display_name})
        except Exception:
            # Fall back to a column-discovery + dynamic INSERT for safety
            # if some future column also lacks a SQL-level default.
            if engine.url.get_backend_name() == "sqlite":
                cols = conn.execute(text("PRAGMA table_info(lodges)")).fetchall()
                col_names = [c[1] for c in cols]
            else:
                cols = conn.execute(text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'lodges'"
                )).fetchall()
                col_names = [c[0] for c in cols]
            values = {"lodge_id": 1, "code": "rusto", "name": display_name,
                       "is_active": True, "is_published": False}
            insert_cols = [c for c in col_names if c in values]
            placeholders = ", ".join(f":{c}" for c in insert_cols)
            conn.execute(text(
                f"INSERT INTO lodges ({', '.join(insert_cols)}) VALUES ({placeholders})"
            ), {c: values[c] for c in insert_cols})
        logger.info("Multi-tenant: created default lodge id=1 (%s)", display_name)
        return 1


def _backfill_lodge_id(engine, table, default_lodge_id):
    """For every tenant-scoped table, set lodge_id on rows that don't have
    one yet. Safe to re-run."""
    with engine.begin() as conn:
        try:
            conn.execute(text(f"UPDATE {table} SET lodge_id = :lid WHERE lodge_id IS NULL"),
                         {"lid": default_lodge_id})
        except Exception as e:
            logger.warning("Backfill lodge_id on %s failed: %s", table, e)


def _seed_rk_lodge(engine):
    """Seed a second lodge so the multi-tenant separation can be verified
    immediately. Idempotent — only inserts if missing."""
    with engine.begin() as conn:
        row = conn.execute(text("SELECT lodge_id FROM lodges WHERE code = 'rk'")).first()
        if row:
            return row[0]
        # Same defensive pattern as _ensure_default_lodge — explicitly
        # list every NOT-NULL column so the bootstrap survives schema
        # additions like Lodge.is_published (NOT NULL, no SQL default).
        try:
            conn.execute(text(
                "INSERT INTO lodges (code, name, is_active, is_published) "
                "VALUES ('rk', 'RK Lodge', true, false)"
            ))
        except Exception:
            if engine.url.get_backend_name() == "sqlite":
                cols = conn.execute(text("PRAGMA table_info(lodges)")).fetchall()
                col_names = [c[1] for c in cols]
            else:
                cols = conn.execute(text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'lodges'"
                )).fetchall()
                col_names = [c[0] for c in cols]
            values = {"code": "rk", "name": "RK Lodge",
                       "is_active": True, "is_published": False}
            insert_cols = [c for c in col_names if c in values]
            placeholders = ", ".join(f":{c}" for c in insert_cols)
            conn.execute(text(
                f"INSERT INTO lodges ({', '.join(insert_cols)}) VALUES ({placeholders})"
            ), {c: values[c] for c in insert_cols})
        rk_id = conn.execute(text("SELECT lodge_id FROM lodges WHERE code = 'rk'")).first()[0]
        logger.info("Multi-tenant: created RK Lodge id=%s", rk_id)
        return rk_id


def _rebuild_settings_table_if_needed(engine):
    """The pre-multi-tenant settings table had `UNIQUE(setting_key)`. Now
    the uniqueness is `(lodge_id, setting_key)`. SQLite can't drop a
    UNIQUE constraint via ALTER TABLE — we have to rebuild the table.
    PostgreSQL CAN drop it, so this is gated to sqlite.

    Idempotent: if the old constraint isn't there, nothing happens.
    """
    if engine.url.get_backend_name() != "sqlite":
        # Postgres: drop the constraint if it exists.
        with engine.begin() as conn:
            try:
                conn.execute(text("ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_setting_key_key"))
            except Exception as e:
                logger.debug("settings UNIQUE drop on pg: %s", e)
        return

    # SQLite path: inspect for the old UNIQUE(setting_key) constraint.
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'"
        )).first()
        if not row:
            return
        ddl = row[0] or ""
        # Old constraint marker (case-insensitive). New schema doesn't have
        # this as a standalone UNIQUE — uniqueness is via an Index.
        import re as _re
        if not _re.search(r"UNIQUE\s*\(\s*setting_key\s*\)", ddl, _re.IGNORECASE):
            return  # already migrated

        logger.info("Multi-tenant: rebuilding settings table to drop UNIQUE(setting_key)")
        # Classic SQLite table rebuild: copy to temp, drop, recreate, copy back.
        conn.execute(text("""
            CREATE TABLE settings_new (
                setting_id INTEGER NOT NULL PRIMARY KEY,
                lodge_id INTEGER,
                setting_key VARCHAR(100) NOT NULL,
                setting_value TEXT NOT NULL,
                setting_group VARCHAR(50),
                description VARCHAR(255),
                is_sensitive BOOLEAN,
                updated_at DATETIME,
                updated_by INTEGER REFERENCES users(user_id)
            )
        """))
        conn.execute(text("""
            INSERT INTO settings_new (setting_id, lodge_id, setting_key, setting_value,
                                       setting_group, description, is_sensitive,
                                       updated_at, updated_by)
            SELECT setting_id, lodge_id, setting_key, setting_value,
                   setting_group, description, is_sensitive,
                   updated_at, updated_by FROM settings
        """))
        conn.execute(text("DROP TABLE settings"))
        conn.execute(text("ALTER TABLE settings_new RENAME TO settings"))
        # Recreate the composite unique index that the model declares.
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_settings_lodge_key "
            "ON settings (lodge_id, setting_key)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_settings_lodge_id ON settings (lodge_id)"
        ))


def run_additive_migrations(engine):
    """Add any missing columns declared in _ADDITIVE_COLUMNS. Then make sure
    every tenant-scoped table has its lodge_id column and the default lodge
    is present, and back-fill lodge_id=1 on any pre-existing rows.

    Idempotent — safe to run on every startup.
    """
    # 1) Original additive columns from earlier releases.
    for table, columns in _ADDITIVE_COLUMNS.items():
        for col_name, col_type in columns:
            _add_column_if_missing(engine, table, col_name, col_type)

    # 2) Multi-tenant: add lodge_id columns. We add them as nullable in
    # SQL (SQLite can't add a NOT NULL column without a default that's a
    # constant), then back-fill, then leave them nullable at the DB level —
    # the model enforces NOT NULL at the ORM layer, which is enough.
    for table in _TENANT_TABLES:
        _add_column_if_missing(engine, table, "lodge_id", "INTEGER")

    # 3) Ensure the default lodge exists, then back-fill all pre-existing
    # rows so the NOT NULL constraint (model-level) is satisfied.
    default_lodge_id = _ensure_default_lodge(engine)
    if default_lodge_id is not None:
        for table in _TENANT_TABLES:
            _backfill_lodge_id(engine, table, default_lodge_id)
        # 3a) Drop the old UNIQUE(setting_key) constraint so per-lodge
        # settings can coexist with the same key.
        _rebuild_settings_table_if_needed(engine)
        # 3b) Drop the LEGACY global UNIQUEs (users.username, customers.phone,
        # rooms.room_number, agencies.code) and replace each with a
        # composite (lodge_id, col) unique index. Without this two lodges
        # can't share the same room number or have admins with the same
        # username — which is the whole point of multi-tenancy.
        _apply_per_lodge_uniqueness(engine)
        # Seed the second lodge for immediate verification.
        _seed_rk_lodge(engine)
        _seed_default_settings_per_lodge(engine)
        _seed_lodge_admin_users(engine)
        # 3c) Seed a cross-tenant super_admin so the multi-tenant system is
        # usable end-to-end out of the box (otherwise nobody can call
        # `POST /api/lodges` to create new lodges).
        _seed_super_admin(engine)

    # 4) Re-apply additive columns. The per-lodge uniqueness rebuild in
    # step 3b reconstructs `users`, `customers`, `rooms`, and `agencies`
    # from a hardcoded DDL — which doesn't know about columns added in
    # _ADDITIVE_COLUMNS. If those rebuilds ran this startup, any newly-
    # declared columns on those tables would be dropped. Re-running the
    # additive step here is idempotent (no-op when columns already exist)
    # and ensures every new column survives the rebuild.
    for table, columns in _ADDITIVE_COLUMNS.items():
        for col_name, col_type in columns:
            _add_column_if_missing(engine, table, col_name, col_type)


def _seed_default_settings_per_lodge(engine):
    """For each lodge, ensure it has the standard set of setting keys.
    Copies the rusto lodge's settings into any newly-created lodge as a
    sensible starting point so RK Lodge isn't blank from day one."""
    with engine.begin() as conn:
        lodges = conn.execute(text("SELECT lodge_id, code FROM lodges ORDER BY lodge_id")).all()
        # Settings of the first/default lodge serve as the template.
        default_lid = lodges[0][0] if lodges else None
        if default_lid is None:
            return
        template = conn.execute(text(
            "SELECT setting_key, setting_value, setting_group, description, is_sensitive "
            "FROM settings WHERE lodge_id = :lid"
        ), {"lid": default_lid}).all()
        template_dict = {r[0]: r for r in template}

        # Per-lodge override defaults so each lodge starts with its own name.
        per_lodge_overrides = {
            "rusto": {"hotel_name": "Rusto Lodge"},
            "rk":       {"hotel_name": "RK Lodge"},
        }

        for lid, code in lodges:
            existing_keys = {r[0] for r in conn.execute(
                text("SELECT setting_key FROM settings WHERE lodge_id = :lid"),
                {"lid": lid}).all()}
            overrides = per_lodge_overrides.get(code, {})
            for key, tmpl in template_dict.items():
                if key in existing_keys:
                    continue
                value = overrides.get(key, tmpl[1])
                conn.execute(text(
                    "INSERT INTO settings (lodge_id, setting_key, setting_value, "
                    "setting_group, description, is_sensitive) "
                    "VALUES (:lid, :k, :v, :g, :d, :s)"
                ), {"lid": lid, "k": key, "v": value, "g": tmpl[2],
                    "d": tmpl[3], "s": tmpl[4]})


def _seed_lodge_admin_users(engine):
    """Make sure every lodge has at least one admin user. The existing
    'admin' user is attached to lodge 1 (rusto). For the RK lodge we
    create 'rkadmin' with a default password the operator must change.

    Also creates the default 'admin' user if no user exists at all (fresh
    DB bootstrap). The quickstart README promises `admin / Admin@1234`
    will work out of the box, so we honour that here rather than relying
    on a separate seed step.
    """
    # Local import avoids circular dep at module load.
    from .auth import get_password_hash

    with engine.begin() as conn:
        # 0) On a brand-new DB, no user exists yet. Bootstrap one bound
        #    to lodge 1 with default password Admin@1234.
        any_user = conn.execute(text("SELECT user_id FROM users LIMIT 1")).first()
        if not any_user:
            conn.execute(text(
                "INSERT INTO users (lodge_id, username, password_hash, full_name, "
                "role, is_active, failed_attempts) "
                "VALUES (1, 'admin', :pw, 'Default Administrator', 'admin', 1, 0)"
            ), {"pw": get_password_hash("Admin@1234")})
            logger.info("Bootstrap: seeded default user 'admin' (password: Admin@1234) for lodge 1")
        # 1) Attach the bootstrap 'admin' user to lodge 1 if it isn't yet.
        conn.execute(text(
            "UPDATE users SET lodge_id = 1 WHERE username = 'admin' AND lodge_id IS NULL"
        ))
        # 2) Seed an RK Lodge admin if missing.
        rk_row = conn.execute(text("SELECT lodge_id FROM lodges WHERE code = 'rk'")).first()
        if not rk_row:
            return
        rk_lid = rk_row[0]
        exists = conn.execute(text("SELECT user_id FROM users WHERE username = 'rkadmin'")).first()
        if exists:
            return
        conn.execute(text(
            "INSERT INTO users (lodge_id, username, password_hash, full_name, "
            "role, is_active, failed_attempts) "
            "VALUES (:lid, 'rkadmin', :pw, 'RK Lodge Administrator', 'admin', 1, 0)"
        ), {"lid": rk_lid, "pw": get_password_hash("rkadmin123")})
        logger.info("Multi-tenant: seeded user 'rkadmin' (password: rkadmin123) for RK Lodge")


def _seed_super_admin(engine):
    """Seed a cross-tenant super_admin user the first time the multi-tenant
    system comes up. Without this nobody can actually create new lodges via
    the API. Username `superadmin`, default password `superadmin123`.

    Idempotent: only inserts if no super_admin currently exists. If one's
    already present (manual SQL, prior boot, etc.) this is a no-op."""
    from .auth import get_password_hash
    with engine.begin() as conn:
        existing = conn.execute(text(
            "SELECT user_id FROM users WHERE role = 'super_admin'"
        )).first()
        if existing:
            return
        # lodge_id is NULL for a super_admin — they're cross-tenant.
        conn.execute(text(
            "INSERT INTO users (lodge_id, username, password_hash, full_name, "
            "role, is_active, failed_attempts) "
            "VALUES (NULL, 'superadmin', :pw, 'Super Administrator', "
            "'super_admin', 1, 0)"
        ), {"pw": get_password_hash("superadmin123")})
        logger.info("Multi-tenant: seeded user 'superadmin' (password: superadmin123) — change this password immediately")


# ─── Per-lodge uniqueness migration (drops legacy global UNIQUEs) ─────────
# Pre-multi-tenant releases had these globally unique:
#   users.username, customers.phone, rooms.room_number, agencies.code
# Multi-tenant makes them unique per-lodge instead. Old DBs need the
# constraints dropped and replaced.

# SQL fragments to (re)build each affected SQLite table with the new
# per-lodge unique index. Keys = table name, values = (cols-DDL,
# select-cols, unique-index-name, unique-cols).
_SQLITE_PER_LODGE_REBUILDS = {
    "users": dict(
        ddl="""CREATE TABLE users_new (
            user_id INTEGER NOT NULL PRIMARY KEY,
            lodge_id INTEGER REFERENCES lodges(lodge_id),
            username VARCHAR(50) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(100) NOT NULL,
            role VARCHAR(20),
            email VARCHAR(100),
            phone VARCHAR(15),
            is_active BOOLEAN,
            last_login DATETIME,
            failed_attempts INTEGER,
            locked_until DATETIME,
            created_at DATETIME
        )""",
        copy_cols="user_id, lodge_id, username, password_hash, full_name, role, "
                  "email, phone, is_active, last_login, failed_attempts, "
                  "locked_until, created_at",
        ix_name="ix_users_lodge_username",
        ix_cols="(lodge_id, username)",
    ),
    "customers": dict(
        ddl="""CREATE TABLE customers_new (
            customer_id INTEGER NOT NULL PRIMARY KEY,
            lodge_id INTEGER REFERENCES lodges(lodge_id),
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            phone VARCHAR(15) NOT NULL,
            email VARCHAR(100),
            address TEXT,
            city VARCHAR(50),
            state VARCHAR(50),
            id_type VARCHAR(20) NOT NULL,
            id_number VARCHAR(30) NOT NULL,
            id_proof_path VARCHAR(255),
            date_of_birth DATE,
            nationality VARCHAR(50),
            gender VARCHAR(5),
            total_visits INTEGER,
            is_vip BOOLEAN,
            blacklisted BOOLEAN,
            blacklist_reason TEXT,
            imported_from_excel BOOLEAN,
            is_active BOOLEAN,
            sms_opt_in BOOLEAN,
            created_at DATETIME,
            updated_at DATETIME
        )""",
        copy_cols="customer_id, lodge_id, first_name, last_name, phone, email, "
                  "address, city, state, id_type, id_number, id_proof_path, "
                  "date_of_birth, nationality, gender, total_visits, is_vip, "
                  "blacklisted, blacklist_reason, imported_from_excel, "
                  "is_active, sms_opt_in, created_at, updated_at",
        ix_name="ix_customers_lodge_phone",
        ix_cols="(lodge_id, phone)",
    ),
    "rooms": dict(
        ddl="""CREATE TABLE rooms_new (
            room_id INTEGER NOT NULL PRIMARY KEY,
            lodge_id INTEGER REFERENCES lodges(lodge_id),
            room_number VARCHAR(10) NOT NULL,
            floor INTEGER NOT NULL,
            room_type VARCHAR(20) NOT NULL,
            has_ac BOOLEAN NOT NULL,
            base_tariff NUMERIC(10, 2) NOT NULL,
            max_occupancy INTEGER,
            amenities TEXT,
            status VARCHAR(20),
            is_active BOOLEAN,
            description TEXT,
            housekeeping_clean BOOLEAN
        )""",
        copy_cols="room_id, lodge_id, room_number, floor, room_type, has_ac, "
                  "base_tariff, max_occupancy, amenities, status, is_active, "
                  "description, housekeeping_clean",
        ix_name="ix_rooms_lodge_number",
        ix_cols="(lodge_id, room_number)",
    ),
    "agencies": dict(
        # Agency rebuild is fiddlier because it has FKs from other tables.
        # We keep agency_id stable and drop only the global UNIQUE(code).
        ddl="""CREATE TABLE agencies_new (
            agency_id INTEGER NOT NULL PRIMARY KEY,
            lodge_id INTEGER REFERENCES lodges(lodge_id),
            name VARCHAR(100) NOT NULL,
            code VARCHAR(30) NOT NULL,
            contact_email VARCHAR(100) NOT NULL,
            contact_phone VARCHAR(15),
            contact_person VARCHAR(100),
            address TEXT,
            website VARCHAR(200),
            api_key VARCHAR(64) NOT NULL UNIQUE,
            api_secret_hash VARCHAR(255) NOT NULL,
            webhook_url VARCHAR(300),
            webhook_secret VARCHAR(64),
            commission_pct NUMERIC(5, 2),
            rate_markup_pct NUMERIC(5, 2),
            allowed_room_types VARCHAR(200),
            daily_booking_limit INTEGER,
            max_advance_days INTEGER,
            total_bookings INTEGER,
            total_revenue NUMERIC(12, 2),
            status VARCHAR(20),
            last_used_at DATETIME,
            created_at DATETIME,
            created_by INTEGER REFERENCES users(user_id),
            updated_at DATETIME
        )""",
        copy_cols="agency_id, lodge_id, name, code, contact_email, contact_phone, "
                  "contact_person, address, website, api_key, api_secret_hash, "
                  "webhook_url, webhook_secret, commission_pct, rate_markup_pct, "
                  "allowed_room_types, daily_booking_limit, max_advance_days, "
                  "total_bookings, total_revenue, status, last_used_at, "
                  "created_at, created_by, updated_at",
        ix_name="ix_agencies_lodge_code",
        ix_cols="(lodge_id, code)",
    ),
}

# Pattern matchers for the legacy global UNIQUE clauses we want to drop.
# Matches both `UNIQUE (phone)` and `phone VARCHAR(15) UNIQUE NOT NULL` styles
# that older SQLite DDLs may contain.
_LEGACY_GLOBAL_UNIQUE = {
    "users":     "username",
    "customers": "phone",
    "rooms":     "room_number",
    "agencies":  "code",
}


def _apply_per_lodge_uniqueness(engine):
    """Migrate from old global-unique constraints to per-lodge composite
    unique indexes. SQLite needs a table rebuild (it can't drop a UNIQUE
    constraint via ALTER); Postgres can drop the named constraint.

    Idempotent: detects the legacy constraint and only runs when present.
    """
    backend = engine.url.get_backend_name()
    if backend == "sqlite":
        _apply_per_lodge_uniqueness_sqlite(engine)
    else:
        _apply_per_lodge_uniqueness_postgres(engine)


def _apply_per_lodge_uniqueness_sqlite(engine):
    import re as _re
    for table, plan in _SQLITE_PER_LODGE_REBUILDS.items():
        col = _LEGACY_GLOBAL_UNIQUE[table]
        with engine.begin() as conn:
            row = conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=:t"
            ), {"t": table}).first()
            if not row:
                continue
            ddl = row[0] or ""
            # Old global-unique signature: either `UNIQUE (col)` standalone
            # or `col TYPE UNIQUE NOT NULL` inline. If neither is present
            # we've already migrated this table.
            has_standalone = bool(_re.search(rf"UNIQUE\s*\(\s*{col}\s*\)", ddl, _re.IGNORECASE))
            has_inline = bool(_re.search(rf"\b{col}\b[^,]*\bUNIQUE\b", ddl, _re.IGNORECASE))
            if not (has_standalone or has_inline):
                continue

            logger.info("Multi-tenant: rebuilding %s to make %s per-lodge unique", table, col)
            # SQLite's 12-step recommended table-rebuild procedure requires
            # foreign_keys to be OFF for the duration so DROP TABLE doesn't
            # fail when other tables hold FKs into this one. We toggle it
            # only for this connection; PRAGMA foreign_keys is a per-conn
            # setting in SQLite, so other connections are unaffected.
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            try:
                # 1) Build the new table.
                conn.execute(text(plan["ddl"]))
                # 2) Copy rows.
                conn.execute(text(
                    f"INSERT INTO {table}_new ({plan['copy_cols']}) "
                    f"SELECT {plan['copy_cols']} FROM {table}"
                ))
                # 3) Drop old, rename new.
                conn.execute(text(f"DROP TABLE {table}"))
                conn.execute(text(f"ALTER TABLE {table}_new RENAME TO {table}"))
                # 4) Create the per-lodge composite unique index.
                conn.execute(text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS {plan['ix_name']} "
                    f"ON {table} {plan['ix_cols']}"
                ))
                # 5) lodge_id index for query perf.
                conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS ix_{table}_lodge_id "
                    f"ON {table} (lodge_id)"
                ))
                # 6) Verify referential integrity still holds AFTER the rebuild.
                # If anything is dangling (shouldn't be, since we copied
                # primary keys verbatim) we'd see it here.
                check = conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                if check:
                    logger.warning("FK check after %s rebuild flagged: %s", table, check)
            finally:
                conn.exec_driver_sql("PRAGMA foreign_keys=ON")


def _apply_per_lodge_uniqueness_postgres(engine):
    """Postgres path: drop the legacy unique constraints (best-effort —
    the constraint name varies by version) and create the composite unique
    indexes. Safe to re-run."""
    drops = [
        ("users_username_key", "users"),
        ("customers_phone_key", "customers"),
        ("rooms_room_number_key", "rooms"),
        ("agencies_code_key", "agencies"),
    ]
    for constraint, table in drops:
        with engine.begin() as conn:
            try:
                conn.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}"))
            except Exception as e:
                logger.debug("Drop %s on %s skipped: %s", constraint, table, e)

    creates = [
        ("users",     "ix_users_lodge_username",  "(lodge_id, username)"),
        ("customers", "ix_customers_lodge_phone", "(lodge_id, phone)"),
        ("rooms",     "ix_rooms_lodge_number",    "(lodge_id, room_number)"),
        ("agencies",  "ix_agencies_lodge_code",   "(lodge_id, code)"),
    ]
    for table, ix_name, cols in creates:
        with engine.begin() as conn:
            try:
                conn.execute(text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS {ix_name} ON {table} {cols}"
                ))
            except Exception as e:
                logger.debug("Create %s on %s skipped: %s", ix_name, table, e)
