#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  bootstrap-tf-backend.sh — run ONCE per AWS account, by hand.
#
#  Terraform stores its state in S3 with a DynamoDB lock table. But
#  Terraform can't create its own state backend (chicken-and-egg), so we
#  create those two resources once with the AWS CLI. Everything else is
#  then managed by Terraform.
#
#  This is the ONLY manual AWS step. After this, all infra is code.
#
#  Usage:
#    AWS_REGION=us-east-1 bash scripts/bootstrap-tf-backend.sh
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
STATE_BUCKET="rusto-tfstate-${ACCOUNT_ID}"
LOCK_TABLE="rusto-tflock"

echo "▶ Creating Terraform state bucket: ${STATE_BUCKET}"
if aws s3api head-bucket --bucket "${STATE_BUCKET}" 2>/dev/null; then
  echo "  already exists"
else
  if [ "${AWS_REGION}" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}"
  else
    aws s3api create-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}" \
      --create-bucket-configuration LocationConstraint="${AWS_REGION}"
  fi
  aws s3api put-bucket-versioning --bucket "${STATE_BUCKET}" \
    --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "${STATE_BUCKET}" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-public-access-block --bucket "${STATE_BUCKET}" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  echo "  ✓ created, versioned, encrypted, private"
fi

echo "▶ Creating DynamoDB lock table: ${LOCK_TABLE}"
if aws dynamodb describe-table --table-name "${LOCK_TABLE}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "  already exists"
else
  aws dynamodb create-table \
    --table-name "${LOCK_TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${AWS_REGION}" >/dev/null
  echo "  ✓ created"
fi

echo
echo "════════════════════════════════════════════════════════════════"
echo " Bootstrap done. Set these as GitHub repo secrets:"
echo "   TF_STATE_BUCKET = ${STATE_BUCKET}"
echo "   TF_LOCK_TABLE   = ${LOCK_TABLE}"
echo "   AWS_ACCOUNT_ID  = ${ACCOUNT_ID}"
echo "   AWS_REGION      = ${AWS_REGION}"
echo " Then run the Infrastructure workflow: environment=staging, action=apply"
echo "════════════════════════════════════════════════════════════════"
