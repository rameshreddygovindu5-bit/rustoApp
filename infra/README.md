# Infrastructure as Code — Udumula's Grand LMS

This directory defines the entire AWS infrastructure for the app as Terraform.
Running it creates everything (VPC, RDS, ECR, S3, IAM, EC2, secrets) and wires
those real resources into the application automatically. Nothing is created by
hand in the console, and nothing is hardcoded.

## What this gives you (your 7 requirements)

1. Infra creation for all components — Terraform creates VPC, subnets, RDS, ECR,
   S3, IAM roles, EC2, and SSM parameters. It's idempotent: re-running only
   changes what drifted.
2. The same components are used by the app — Terraform outputs (bucket, RDS
   endpoint, ECR URL, SSM prefix) are read by the deploy pipeline and injected
   into the app. One source, so they can't disagree.
3. Cross-checked — the app reads config the pipeline generated from Terraform
   outputs; there is no second place to keep in sync.
4. No hardcoding — non-secret config comes from Terraform outputs; secrets live
   in SSM Parameter Store and are read at runtime. Nothing sensitive is in the
   repo, images, or `.env` on disk.
5. Deploy to any new account — after a one-time state-backend bootstrap, run the
   infra workflow with `action=apply` and the whole stack builds itself.
6. No physical involvement — after bootstrap, everything is pipeline-driven.
7. Pipeline asks for input — the infra workflow has `environment` and `action`
   dropdowns; the deploy workflow has an environment dropdown.

## Layout

```
infra/
  versions.tf         provider + S3 remote state backend
  variables.tf        root inputs (region, sizing, secrets)
  main.tf             wires all modules together
  outputs.tf          what the deploy pipeline consumes
  envs/
    staging.tfvars    non-secret staging values
    production.tfvars non-secret production values
  modules/
    network/          VPC, subnets, routing
    security/         security groups (app + RDS)
    database/         RDS Postgres + generated password + DATABASE_URL
    registry/         ECR repos + lifecycle policy
    storage/          S3 uploads bucket (private, encrypted, versioned)
    secrets/          SSM SecureString params (DATABASE_URL, JWT, etc.)
    compute/          IAM role, EC2, EIP, user-data bootstrap
```

## One-time setup (per AWS account)

1. Bootstrap the Terraform state backend (the only manual AWS step):
   ```bash
   AWS_REGION=us-east-1 bash scripts/bootstrap-tf-backend.sh
   ```
   It prints the `TF_STATE_BUCKET` and `TF_LOCK_TABLE` names.

2. Add GitHub repo secrets (Settings → Secrets and variables → Actions):
   - Shared: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
     `AWS_ACCOUNT_ID`, `TF_STATE_BUCKET`, `TF_LOCK_TABLE`, `SSH_PUBLIC_KEY`,
     `EC2_SSH_KEY` (private key matching `SSH_PUBLIC_KEY`), `EC2_USER` (`ubuntu`).
   - Per environment (GitHub Environments `staging` / `production`):
     `TF_VAR_JWT_SECRET_KEY`, `TF_VAR_DEFAULT_ADMIN_PASSWORD`,
     `TF_VAR_ANTHROPIC_API_KEY` (optional).

3. Run the Infrastructure workflow:
   - Actions → Infrastructure (Terraform) → Run workflow
   - environment = `staging`, action = `plan` (review), then `apply`.

4. Deploy the app:
   - Push to `develop` (staging) or `main` (production), or run the deploy
     workflow manually. It reads the Terraform outputs, generates the box's
     `.env`, and rolls the stack — no SSH, no hand-editing.

## How the cross-check works (points 2–4)

- The database module generates the RDS password and assembles the full
  `DATABASE_URL`, then writes it to SSM. The app reads it from SSM at runtime.
- The storage module creates the S3 bucket; its name is a Terraform output.
- The deploy pipeline reads `terraform output` and writes the box's `.env` with
  `S3_BUCKET`, `SSM_PREFIX`, `CONFIG_SOURCE=ssm`, etc. — all from Terraform.
- The app's `config_loader.py` pulls secrets from `SSM_PREFIX` into the
  environment at startup, before anything reads them.

So the bucket name, RDS endpoint, and secrets exist in exactly one place each.
Nobody types them twice, so they can't drift.

## Local development still works

With `CONFIG_SOURCE` unset (the default), the app ignores SSM and uses local
`.env` / environment values, and `STORAGE_BACKEND=local` keeps uploads on disk —
exactly as before. The AWS path only activates in the deployed environments.

## Cost note

Roughly: staging ~$25–35/mo (t3.small + db.t4g.micro), production ~$50–70/mo
(t3.medium + db.t4g.small, multi-AZ). SSM standard parameters and ECR at this
scale are effectively free. Destroy staging when not needed with the infra
workflow (`action=destroy`) to save cost.

## Safety checks before you apply

Two layers catch problems before they reach a real apply:

1. Validation workflow (`.github/workflows/validate-infra.yml`) runs on every
   push touching `infra/` — `terraform fmt`, `terraform validate`, and `tflint`.
   No AWS credentials needed; it's an offline syntax/lint gate.

2. Pre-flight check (`scripts/preflight-check.sh`) runs automatically inside the
   infra workflow before `apply`, and you can run it by hand:
   ```bash
   AWS_REGION=us-east-1 \
   TF_STATE_BUCKET=rusto-tfstate-<account> \
   TF_LOCK_TABLE=rusto-tflock \
     bash scripts/preflight-check.sh
   ```
   It verifies, in one place: AWS credentials work and match the expected
   account, the Terraform state backend exists, required secrets are set, the
   RDS engine version is available in your region, and `terraform validate`
   passes. It only reads — it never changes anything — and exits non-zero on a
   hard failure so the pipeline stops before touching infrastructure.

## Phase 2 (later)

Nothing here is throwaway if you move the run layer to ECS Fargate later — the
VPC, RDS, ECR, S3, IAM, and secrets modules carry straight over; only the
compute module changes.

---

## Multi-account: the AWS account is a parameter

The pipeline no longer hardcodes an account or uses static access keys. It uses
GitHub OIDC to assume a role in the TARGET account, and which account it targets
is a parameter.

### How the account becomes a parameter

The deploy role name is fixed (`rusto-gha-deploy`, created by the
bootstrap). So the role ARN — and therefore the account — is fully determined
by the account ID:

```
arn:aws:iam::<ACCOUNT_ID>:role/rusto-gha-deploy
```

In the `pipeline.yml` run form you can type `aws_account_id`. If you leave it
blank, the environment's `AWS_ACCOUNT_ID` secret is used. Either way, the
pipeline assumes that account's role and everything (ECR, Terraform, deploy)
happens in that account.

### Onboarding a brand-new account (fully automated after one bootstrap)

1. Point your AWS CLI at the new account (admin creds), then:
   ```bash
   terraform -chdir=infra/bootstrap init
   terraform -chdir=infra/bootstrap apply -var github_repo=OWNER/REPO
   ```
   This creates the GitHub OIDC provider + the `rusto-gha-deploy` role
   and prints its ARN. This is the ONLY step needing human AWS credentials.
2. Note the account ID (printed as `account_id`).
3. Run the pipeline (Actions → Pipeline) with:
   - `source` = infra (or both)
   - `aws_account_id` = the new account's ID
   - `infra_action` = apply
   From here everything runs in that account with no static keys.

### Required GitHub secrets (OIDC model)

Shared: `AWS_REGION`, `TF_STATE_BUCKET`, `TF_LOCK_TABLE`, `SSH_PUBLIC_KEY`,
`EC2_SSH_KEY`, `EC2_USER`.
Per environment: `AWS_ACCOUNT_ID` (the account for that environment). For the
automatic `release.yml` promotion, also `AWS_ACCOUNT_ID_STAGING`.
No `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` anywhere — OIDC replaces them.

Note: if staging and production are SEPARATE accounts, the Terraform state
bucket/lock table must be reachable by the deploy role in each account (either
one shared tooling account's bucket with cross-account access, or a state
bucket per account). See the "state backend per account" note below.
