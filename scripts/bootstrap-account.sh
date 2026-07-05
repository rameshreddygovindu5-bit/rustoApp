#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  One-shot account bootstrap using ONLY the AWS CLI (no terraform).
#  Creates exactly what the pipeline needs to authenticate:
#    • the GitHub OIDC provider
#    • the rusto-gha-deploy role trusting your repo
#    • the state bucket + lock table
#
#  Run in AWS CloudShell (signed into the TARGET account) or any shell
#  with admin AWS creds for that account:
#     bash bootstrap-account.sh
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="rameshreddygovindu5-bit/rustoApp"
ROLE="rusto-gha-deploy"
REGION="${AWS_REGION:-ap-south-1}"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "▶ Target account: $ACCOUNT   repo: $REPO   region: $REGION"
echo ""

# ── 1. OIDC provider (idempotent) ───────────────────────────────────
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "✓ OIDC provider already exists"
else
  echo "▶ Creating GitHub OIDC provider ..."
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" >/dev/null
  echo "✓ OIDC provider created"
fi

# ── 2. Deploy role trusting the repo ────────────────────────────────
cat > /tmp/trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:${REPO}:*" }
    }
  }]
}
JSON

if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "▶ Role exists — updating its trust policy ..."
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document file:///tmp/trust.json
else
  echo "▶ Creating role $ROLE ..."
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document file:///tmp/trust.json >/dev/null
fi

echo "▶ Attaching PowerUserAccess + scoped IAM permissions ..."
aws iam attach-role-policy --role-name "$ROLE" \
  --policy-arn "arn:aws:iam::aws:policy/PowerUserAccess"

cat > /tmp/iam-inline.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "iam:CreateRole","iam:DeleteRole","iam:GetRole","iam:PassRole",
      "iam:AttachRolePolicy","iam:DetachRolePolicy","iam:PutRolePolicy",
      "iam:DeleteRolePolicy","iam:GetRolePolicy","iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies","iam:CreateInstanceProfile",
      "iam:DeleteInstanceProfile","iam:AddRoleToInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile","iam:GetInstanceProfile",
      "iam:TagRole","iam:TagInstanceProfile","iam:CreatePolicy",
      "iam:DeletePolicy","iam:GetPolicy","iam:GetOpenIDConnectProvider"
    ],
    "Resource": "*"
  }]
}
JSON
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name "${ROLE}-iam" --policy-document file:///tmp/iam-inline.json
echo "✓ Role ready"

# ── 3. Terraform state backend ──────────────────────────────────────
BUCKET="rusto-tfstate-${ACCOUNT}"
LOCK="rusto-tflock"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "✓ State bucket already exists: $BUCKET"
else
  echo "▶ Creating state bucket $BUCKET ..."
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
  aws s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  echo "✓ State bucket created"
fi

if aws dynamodb describe-table --table-name "$LOCK" >/dev/null 2>&1; then
  echo "✓ Lock table already exists: $LOCK"
else
  echo "▶ Creating lock table $LOCK ..."
  aws dynamodb create-table --table-name "$LOCK" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  echo "✓ Lock table created"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓ DONE. Account $ACCOUNT now trusts $REPO."
echo "  Deploy role: arn:aws:iam::${ACCOUNT}:role/${ROLE}"
echo "  State bucket: $BUCKET"
echo "  Lock table:  $LOCK"
echo ""
echo "  Re-run the GitHub pipeline — OIDC will now succeed."
echo "════════════════════════════════════════════════════════════"
