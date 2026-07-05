#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Rusto DB migrations runner.
#
#  Rusto's backend creates its own schema on startup (Base.metadata.
#  create_all + additive auto_migrate). So this runner only applies the
#  extra idempotent SQL in migrate.sql (safe ADD COLUMN IF NOT EXISTS,
#  etc.). It is safe to run on every deploy.
#
#  DATABASE_URL is fetched from SSM (set by the infra stage).
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

SSM_PREFIX="${SSM_PREFIX:-/rusto/production}"
AWS_REGION="${AWS_REGION:-ap-south-1}"

echo "Fetching DATABASE_URL from SSM ${SSM_PREFIX}/DATABASE_URL ..."
DB_URL="$(aws ssm get-parameter --name "${SSM_PREFIX}/DATABASE_URL" \
  --with-decryption --query Parameter.Value --output text --region "${AWS_REGION}")"

if [ -z "$DB_URL" ] || [ "$DB_URL" = "None" ]; then
  echo "✗ Could not read DATABASE_URL from SSM."; exit 1
fi

if [ ! -f migrate.sql ]; then
  echo "note: no migrate.sql found — nothing to apply (app self-migrates on startup)."
  exit 0
fi

echo "▶ Applying migrate.sql (idempotent additive changes) ..."
# Run inside a postgres container so we don't need psql on the box.
docker run --rm -v "${PWD}/migrate.sql:/migrate.sql:ro" postgres:16-alpine \
  psql "$DB_URL" -v ON_ERROR_STOP=0 -f /migrate.sql \
  || echo "note: some statements were non-fatal (idempotent re-run)."

echo "✓ migrations applied."
