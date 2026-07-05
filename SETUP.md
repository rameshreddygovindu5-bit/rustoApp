# Rusto LMS — Deployment (same model as Udumula's Grand)

Deploys to the **same AWS account** as udumulas, with fully distinct resource
names so the two apps coexist without collision.

## Distinct resources (vs udumulas)
| | udumulas | rusto |
|---|---|---|
| Deploy role | udumulas-lms-gha-deploy | **rusto-gha-deploy** |
| State bucket | udumulas-lms-tfstate-<acct> | **rusto-tfstate-<acct>** |
| VPC CIDR | 10.30.0.0/16 | **10.40.0.0/16** |
| ECR repos | udumulas-lms-backend/frontend | **rusto-backend, rusto-frontend-pms, rusto-frontend-customer** |
| SSM prefix | /udumulas-lms/production | **/rusto/production** |
| App dir | /opt/udumulas-lms | **/opt/rusto** |

## One-time setup (per account)
In AWS CloudShell (signed into account 825187894930), with `gh` logged in:
```bash
export GITHUB_REPO="rameshreddygovindu5-bit/rustoApp"   # your rusto repo
export AWS_REGION="ap-south-1"
bash scripts/setup-everything.sh
```
Creates: OIDC-trusted `rusto-gha-deploy` role, `rusto-tfstate-<acct>` bucket +
lock table, an SSH keypair, and all GitHub variables/secrets/approval envs.

Then add yourself as a Required reviewer on the six `approve-*` environments
(Settings → Environments) if you want per-stage approval gates.

## Deploying
Push, or run Actions → Pipeline → Run. Stages:
```
resolve → test → validate → build → infra → database → deploy
```
- **build** produces THREE images: backend, frontend-pms, frontend-customer
  (the two portals are one source built with different PORTAL args).
- **infra** provisions VPC (10.40/16), RDS, EC2, S3, SSM — all rusto-named.
- **database** runs the idempotent migrate.sql (the app also self-creates its
  schema on startup via create_all + additive auto_migrate).
- **deploy** logs into ECR, pulls all three images, rolls the stack behind
  nginx, health-checks /api/health, auto-rolls-back on failure.

## Access (no domain needed)
nginx uses the IP-only config by default:
- Customer portal:  http://<APP_IP>/
- PMS (staff):       http://<APP_IP>/pms
- API:               http://<APP_IP>/api/

For a real domain later, swap `nginx/conf.d/default.conf` for the saved
`default.conf.domain-example` and run `scripts/enable-tls.sh`.

## Recovery scripts (rarely needed)
- scripts/force-reset.sh — clear TF state + orphans + DynamoDB digest
- scripts/cleanup-leftovers.sh — remove "already exists" resources
