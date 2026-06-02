-- ────────────────────────────────────────────────────────────────────
-- Postgres init script for Udumula's Grand LMS.
--
-- Runs ONCE when the Postgres container starts with an empty data
-- directory.  After that, it is silently ignored even on container
-- recreation, so this is safe to leave in place.
--
-- Notes:
--   * The database itself is created automatically by the postgres
--     image from the POSTGRES_DB env var — we don't need to CREATE it.
--   * The user is created automatically from POSTGRES_USER /
--     POSTGRES_PASSWORD with full ownership of POSTGRES_DB, so we
--     don't need explicit GRANTs either.
--   * We just need to ensure useful extensions are present.
-- ────────────────────────────────────────────────────────────────────

-- Connect to the application DB (it exists thanks to POSTGRES_DB)
\c :"POSTGRES_DB"

-- Useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- (Schema and tables are created by SQLAlchemy's Base.metadata.create_all
--  on first app startup — no DDL is needed here.)
