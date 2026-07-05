terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # ── Remote state ──────────────────────────────────────────────────
  # State is stored in S3 (with DynamoDB locking) so any machine or CI
  # runner can apply safely without stepping on each other. The bucket
  # and lock table are created ONCE by the bootstrap (see infra/README).
  # Values are supplied at `terraform init` time via -backend-config so
  # nothing here is account-specific / hardcoded.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "rusto"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
