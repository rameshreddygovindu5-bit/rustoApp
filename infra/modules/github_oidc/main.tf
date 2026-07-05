# ════════════════════════════════════════════════════════════════════
#  GitHub OIDC provider + deploy role.
#
#  This is what makes an AWS ACCOUNT trust your GitHub repo, so the
#  pipeline can assume a role in THAT account with NO stored static keys.
#  Run this once per target account (staging account, prod account, ...).
#
#  The account is fully parameterized: point your AWS credentials at any
#  account, apply this module, and that account now trusts the repo. The
#  pipeline then targets it purely by the resulting role ARN.
# ════════════════════════════════════════════════════════════════════

data "aws_caller_identity" "current" {}

# The GitHub OIDC identity provider (one per account).
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # GitHub's OIDC thumbprint (AWS now validates via its trust store, but
  # the field is still required).
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  oidc_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

# Trust policy: only your repo (and optionally only certain branches) may
# assume this role, and only via GitHub's OIDC token.
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # e.g. repo:my-org/rusto:*  (all branches) — tighten to
      # repo:my-org/rusto:ref:refs/heads/main if desired.
      values = ["repo:${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.project}-gha-deploy"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# The deploy role gets the permissions the pipeline needs: manage infra
# via Terraform and push/pull ECR. For a first cut we attach broad managed
# policies; tighten later to least-privilege for production.
resource "aws_iam_role_policy_attachment" "power" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# PowerUserAccess excludes IAM; the pipeline also creates IAM roles
# (instance profile), so grant scoped IAM management too.
data "aws_iam_policy_document" "iam" {
  statement {
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PassRole",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
      "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
      "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile",
      "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
      "iam:GetInstanceProfile", "iam:TagRole", "iam:TagInstanceProfile",
      "iam:CreateOpenIDConnectProvider", "iam:GetOpenIDConnectProvider",
      "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "iam" {
  name   = "${var.project}-gha-iam"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.iam.json
}
