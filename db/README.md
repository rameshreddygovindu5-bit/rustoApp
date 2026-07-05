# Database migrations

Schema changes (tables, columns, indexes, any DDL) live here as **versioned,
ordered SQL migrations**. This is the single, clear way the database evolves —
no more scattered startup logic.

## How it works

- Each change is a file in `db/migrations/` named `NNNN_description.sql`
  (e.g. `0003_add_loyalty_table.sql`), applied in numeric order.
- `run-migrations.sh` applies each file exactly once, tracked in a
  `schema_migrations` table. Re-running is safe — applied files are skipped.
- Each migration runs in a single transaction, so a failure leaves nothing
  half-applied.

## Adding a migration

1. Copy `0002_example_add_index.sql` to the next number.
2. Write forward-only, idempotent DDL (`IF NOT EXISTS`, `ADD COLUMN IF NOT
   EXISTS`).
3. Commit. The pipeline's **database** stage applies it.

## Running migrations

Automatically, via the pipeline (Actions → Pipeline → `source = database` or
`all`). It runs the migrations from the app EC2 box (RDS is private) and then
prints connection info to the run summary.

Manually (from anywhere that can reach the DB):
```bash
DATABASE_URL=postgresql://user:pass@host:5432/db bash db/run-migrations.sh
```

## In production the app does NOT auto-migrate

The deployed app runs with `DB_AUTO_MIGRATE=false`, so it never alters the
schema on startup — the pipeline owns that. In local dev (default), the app
still auto-creates tables so you can run with zero setup.

## Connecting from your laptop

RDS is private (in-VPC, not public). The pipeline's database stage prints an
SSH-tunnel recipe to connect through the app server. Summary:
```bash
# 1. tunnel local 5433 -> RDS:5432 through the app box
ssh -i your-key.pem -L 5433:<rds-endpoint>:5432 ubuntu@<app-ip> -N
# 2. get the password from SSM, then:
psql 'postgresql://lms_admin:<password>@localhost:5433/rusto_lms'
```
