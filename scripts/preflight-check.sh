#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  preflight-check.sh — run BEFORE the first `terraform apply` (and any
#  time a deploy fails for a config reason). It verifies, in one place,
#  that everything the pipeline needs actually exists and is reachable:
#
#    • AWS credentials work and point at the expected account
#    • Terraform state backend (S3 bucket + DynamoDB lock table) exists
#    • Required env-provided secrets are set (when run in CI)
#    • The chosen region supports the RDS engine version
#    • terraform fmt/validate pass
#
#  It only READS — it never creates or changes anything. Exit code is
#  non-zero if any hard check fails, so CI can gate on it.
#
#  Usage:
#    AWS_REGION=us-east-1 \
#    TF_STATE_BUCKET=rusto-tfstate-123456789012 \
#    TF_LOCK_TABLE=rusto-tflock \
#    DB_ENGINE_VERSION=16.4 \
#      bash scripts/preflight-check.sh
# ════════════════════════════════════════════════════════════════════
set -uo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
DB_ENGINE_VERSION="${DB_ENGINE_VERSION:-16.4}"

PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $*"; FAIL=$((FAIL+1)); }
warn() { echo "  ! $*"; WARN=$((WARN+1)); }
hr()   { echo "────────────────────────────────────────────────────────"; }

echo "▶ PRE-FLIGHT CHECK (read-only)"
hr

# ── 1. AWS CLI + credentials ────────────────────────────────────────
echo "AWS access:"
if ! command -v aws >/dev/null 2>&1; then
  bad "aws CLI not installed"
else
  ok "aws CLI present"
  if IDENT=$(aws sts get-caller-identity --output json 2>/dev/null); then
    ACCT=$(echo "$IDENT" | sed -n 's/.*"Account": *"\([0-9]*\)".*/\1/p')
    ok "credentials valid (account ${ACCT})"
    if [ -n "${AWS_ACCOUNT_ID:-}" ] && [ "${AWS_ACCOUNT_ID}" != "${ACCT}" ]; then
      bad "AWS_ACCOUNT_ID (${AWS_ACCOUNT_ID}) != actual account (${ACCT})"
    fi
  else
    bad "aws sts get-caller-identity failed — credentials missing or invalid"
  fi
fi
hr

# ── 2. Terraform state backend exists ───────────────────────────────
echo "Terraform state backend:"
if [ -z "${TF_STATE_BUCKET:-}" ]; then
  warn "TF_STATE_BUCKET not set (skip check) — run scripts/bootstrap-tf-backend.sh first"
else
  if aws s3api head-bucket --bucket "${TF_STATE_BUCKET}" 2>/dev/null; then
    ok "state bucket ${TF_STATE_BUCKET} exists"
  else
    bad "state bucket ${TF_STATE_BUCKET} not found — run scripts/bootstrap-tf-backend.sh"
  fi
fi
if [ -z "${TF_LOCK_TABLE:-}" ]; then
  warn "TF_LOCK_TABLE not set (skip check)"
else
  if aws dynamodb describe-table --table-name "${TF_LOCK_TABLE}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    ok "lock table ${TF_LOCK_TABLE} exists"
  else
    bad "lock table ${TF_LOCK_TABLE} not found — run scripts/bootstrap-tf-backend.sh"
  fi
fi
hr

# ── 3. Required secrets present (mainly for CI) ─────────────────────
echo "Required secrets (env vars):"
for v in TF_VAR_jwt_secret_key TF_VAR_default_admin_password TF_VAR_ssh_public_key; do
  if [ -n "${!v:-}" ]; then ok "$v is set"; else warn "$v not set (required at apply time in CI)"; fi
done
hr

# ── 4. RDS engine version available in region ───────────────────────
echo "RDS engine availability:"
if command -v aws >/dev/null 2>&1; then
  if aws rds describe-db-engine-versions \
        --engine postgres --engine-version "${DB_ENGINE_VERSION}" \
        --region "${AWS_REGION}" \
        --query 'DBEngineVersions[0].EngineVersion' --output text 2>/dev/null | grep -q "${DB_ENGINE_VERSION}"; then
    ok "PostgreSQL ${DB_ENGINE_VERSION} available in ${AWS_REGION}"
  else
    warn "PostgreSQL ${DB_ENGINE_VERSION} not confirmed in ${AWS_REGION} — check db_engine_version in tfvars"
  fi
fi
hr

# ── 5. terraform fmt + validate ─────────────────────────────────────
echo "Terraform static checks:"
if command -v terraform >/dev/null 2>&1; then
  ROOT="$(cd "$(dirname "$0")/../infra" && pwd)"
  if terraform -chdir="$ROOT" fmt -check -recursive >/dev/null 2>&1; then
    ok "terraform fmt clean"
  else
    warn "terraform fmt would make changes (run: terraform -chdir=infra fmt -recursive)"
  fi
  if terraform -chdir="$ROOT" init -backend=false -input=false >/dev/null 2>&1 \
     && terraform -chdir="$ROOT" validate >/dev/null 2>&1; then
    ok "terraform validate passed"
  else
    bad "terraform validate failed — run: terraform -chdir=infra validate"
  fi
else
  warn "terraform binary not present — skipping fmt/validate (CI runs these)"
fi
hr

echo "RESULT: ${PASS} passed, ${WARN} warnings, ${FAIL} failures"
if [ "${FAIL}" -gt 0 ]; then
  echo "✗ Not ready — resolve the failures above before applying."
  exit 1
fi
echo "✓ Ready to apply (review any warnings first)."
