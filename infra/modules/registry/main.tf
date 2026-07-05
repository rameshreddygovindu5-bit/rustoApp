# ════════════════════════════════════════════════════════════════════
#  ECR repositories.
#
#  The PIPELINE's build stage creates these repos idempotently (it runs
#  before infra and needs them to push images). So Terraform does NOT
#  create them — it would double-create and conflict. Instead we compute
#  the repo URLs from the account + region for the outputs other modules
#  and the deploy stage consume.
# ════════════════════════════════════════════════════════════════════

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  repos    = ["${var.project}-backend", "${var.project}-frontend"]
  registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com"
}
