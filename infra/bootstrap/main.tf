# ════════════════════════════════════════════════════════════════════
#  Account bootstrap — run ONCE per AWS account, by hand, with admin
#  credentials for THAT account. It makes the account trust your GitHub
#  repo via OIDC and creates the deploy role the pipeline will assume.
#
#  This is the ONLY step that needs human AWS credentials. After it, the
#  pipeline uses the resulting role ARN (no static keys) — so any new
#  account becomes deployable by:
#     1. aws configure  (admin creds for the new account)
#     2. terraform -chdir=infra/bootstrap apply -var github_repo=OWNER/REPO
#     3. copy the printed role ARN into the pipeline input / secret
# ════════════════════════════════════════════════════════════════════
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # Local state is fine for bootstrap (a single role). Keep it in the repo
  # or a safe place; it contains no secrets.
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "github_repo" {
  description = "owner/name, e.g. my-org/rusto"
  type        = string
}

variable "create_oidc_provider" {
  description = "Set false if this account already has the GitHub OIDC provider."
  type        = bool
  default     = true
}

module "oidc" {
  source               = "../modules/github_oidc"
  github_repo          = var.github_repo
  create_oidc_provider = var.create_oidc_provider
}

# ── Terraform state backend for THIS account ────────────────────────
# Each account holds its own state bucket + lock table, so the same
# source can deploy to any account with no shared/cross-account wiring.
data "aws_caller_identity" "boot" {}

resource "aws_s3_bucket" "tfstate" {
  bucket = "rusto-tfstate-${data.aws_caller_identity.boot.account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tflock" {
  name         = "rusto-tflock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}

output "deploy_role_arn" {
  description = "Put this in the pipeline (AWS_ROLE_ARN secret or role_arn input)."
  value       = module.oidc.deploy_role_arn
}

output "account_id" {
  value = module.oidc.account_id
}

output "tf_state_bucket" {
  description = "Set as the TF_STATE_BUCKET secret (or it's derivable from account id)."
  value       = aws_s3_bucket.tfstate.id
}

output "tf_lock_table" {
  description = "Set as the TF_LOCK_TABLE secret."
  value       = aws_dynamodb_table.tflock.name
}
