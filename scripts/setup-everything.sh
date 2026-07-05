#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  setup-everything.sh — ONE-TIME, FULLY-SCRIPTED setup.
#
#  Runs every manual step so you never touch the AWS console or GitHub UI:
#    1. Bootstraps the AWS account (OIDC provider, deploy role, TF state).
#    2. Creates GitHub repo variables, secrets, and approval environments.
#    3. Generates an SSH keypair for the app server if you don't have one.
#
#  Run once per account, in AWS CloudShell (or any shell with admin AWS
#  creds for the target account) AND the GitHub CLI `gh` authenticated.
#
#  Prereqs:
#    - aws cli (CloudShell has it)
#    - gh cli, logged in:   gh auth login
#    - terraform (only if you want IaC bootstrap; the CLI path needs none)
#
#  Usage:
#    export GITHUB_REPO="rameshreddygovindu5-bit/rustoApp"
#    export AWS_REGION="ap-south-1"
#    bash scripts/setup-everything.sh
# ════════════════════════════════════════════════════════════════════
set -uo pipefail

GITHUB_REPO="${GITHUB_REPO:-rameshreddygovindu5-bit/rustoApp}"
REGION="${AWS_REGION:-ap-south-1}"
ROLE="rusto-gha-deploy"

echo "════════════════════════════════════════════════════════════"
echo " FULLY-SCRIPTED SETUP"
echo "   repo:   $GITHUB_REPO"
echo "   region: $REGION"
echo "════════════════════════════════════════════════════════════"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "▶ Target AWS account: $ACCOUNT"
echo ""

# ── 1. AWS account bootstrap (OIDC + role + state backend) ──────────
echo "━━━ Step 1/4: AWS bootstrap ━━━"
if [ -f "$(dirname "$0")/bootstrap-account.sh" ]; then
  AWS_REGION="$REGION" bash "$(dirname "$0")/bootstrap-account.sh"
else
  echo "  ✗ bootstrap-account.sh not found next to this script."; exit 1
fi
echo ""

# ── 2. SSH keypair for the app server ───────────────────────────────
echo "━━━ Step 2/4: SSH keypair ━━━"
KEYFILE="$HOME/rusto-key"
if [ -f "$KEYFILE" ]; then
  echo "  ✓ using existing key at $KEYFILE"
else
  ssh-keygen -t rsa -b 4096 -f "$KEYFILE" -N "" -C "rusto-deploy"
  echo "  ✓ generated new keypair at $KEYFILE (+ .pub)"
fi
PUBKEY="$(cat "${KEYFILE}.pub")"
PRIVKEY="$(cat "$KEYFILE")"
echo ""

# ── 3. GitHub variables, secrets, environments ──────────────────────
echo "━━━ Step 3/4: GitHub config (needs 'gh' logged in) ━━━"
if ! command -v gh >/dev/null 2>&1; then
  echo "  ✗ GitHub CLI 'gh' not found. Install it and run 'gh auth login', then re-run."
  echo "    (Steps 1 & 2 are done; only GitHub config remains.)"
  exit 1
fi

# Repo variables (non-secret)
gh variable set AWS_ACCOUNT_ID --repo "$GITHUB_REPO" --body "$ACCOUNT"     && echo "  ✓ var AWS_ACCOUNT_ID"
gh variable set AWS_REGION     --repo "$GITHUB_REPO" --body "$REGION"      && echo "  ✓ var AWS_REGION"
gh variable set TARGET_ENV     --repo "$GITHUB_REPO" --body "production"   && echo "  ✓ var TARGET_ENV"

# Secrets — generate strong values where the user didn't supply one.
JWT="${TF_VAR_JWT_SECRET_KEY:-$(openssl rand -hex 32)}"
ADMINPW="${TF_VAR_DEFAULT_ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)}"
ANTHROPIC="${TF_VAR_ANTHROPIC_API_KEY:-}"

gh secret set AWS_REGION                    --repo "$GITHUB_REPO" --body "$REGION"    && echo "  ✓ secret AWS_REGION"
gh secret set EC2_USER                      --repo "$GITHUB_REPO" --body "ubuntu"     && echo "  ✓ secret EC2_USER"
printf '%s' "$PUBKEY"  | gh secret set SSH_PUBLIC_KEY  --repo "$GITHUB_REPO"          && echo "  ✓ secret SSH_PUBLIC_KEY"
printf '%s' "$PRIVKEY" | gh secret set EC2_SSH_KEY     --repo "$GITHUB_REPO"          && echo "  ✓ secret EC2_SSH_KEY"
gh secret set TF_VAR_JWT_SECRET_KEY         --repo "$GITHUB_REPO" --body "$JWT"       && echo "  ✓ secret TF_VAR_JWT_SECRET_KEY"
gh secret set TF_VAR_DEFAULT_ADMIN_PASSWORD --repo "$GITHUB_REPO" --body "$ADMINPW"   && echo "  ✓ secret TF_VAR_DEFAULT_ADMIN_PASSWORD"
gh secret set TF_VAR_ANTHROPIC_API_KEY      --repo "$GITHUB_REPO" --body "$ANTHROPIC" && echo "  ✓ secret TF_VAR_ANTHROPIC_API_KEY"
echo ""
echo "  Admin login will be: username 'admin', password '$ADMINPW'"
echo "  (Save this password now — it's also stored in SSM after deploy.)"
echo ""

# ── 4. GitHub approval environments ─────────────────────────────────
echo "━━━ Step 4/4: approval environments ━━━"
OWNER="${GITHUB_REPO%/*}"; NAME="${GITHUB_REPO#*/}"
for env in approve-test approve-validate approve-build approve-infra approve-database approve-deploy; do
  gh api -X PUT "repos/$OWNER/$NAME/environments/$env" >/dev/null 2>&1 \
    && echo "  ✓ environment $env" || echo "  (couldn't create $env — create it in Settings → Environments)"
done
echo ""
echo "  NOTE: to require your approval on each stage, add yourself as a"
echo "  'Required reviewer' on each environment (Settings → Environments)."
echo "  gh can create the environments but reviewers must be added in the UI."
echo ""

echo "════════════════════════════════════════════════════════════"
echo "✓ SETUP COMPLETE — no console clicking needed."
echo "  Push to the repo (or run the pipeline) and it deploys end-to-end:"
echo "    resolve → test → validate → build → infra → database → deploy"
echo "════════════════════════════════════════════════════════════"
