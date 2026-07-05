#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  force-reset.sh — the definitive, no-terraform state reset.
#
#  Directly deletes the Terraform state file and the orphaned us-east-1
#  resources, so the next pipeline run builds cleanly in ap-south-1.
#
#  Run in AWS CloudShell (account 825187894930). No terraform needed.
# ════════════════════════════════════════════════════════════════════
set -uo pipefail

ACCOUNT="825187894930"
STATE_BUCKET="rusto-tfstate-${ACCOUNT}"
STATE_KEY="rusto/production/terraform.tfstate"

echo "▶ 1. Deleting the Terraform state file (this is what still holds us-east-1)..."
# The state bucket itself was created by bootstrap; find its region.
SB_REGION=$(aws s3api get-bucket-location --bucket "$STATE_BUCKET" --query LocationConstraint --output text 2>/dev/null || echo "None")
[ "$SB_REGION" = "None" ] && SB_REGION="us-east-1"
echo "   (state bucket $STATE_BUCKET is in $SB_REGION)"

# delete ALL versions of the state file (bucket is versioned)
aws s3api list-object-versions --bucket "$STATE_BUCKET" --prefix "$STATE_KEY" \
  --query 'Versions[].{Key:Key,VersionId:VersionId}' --output json --region "$SB_REGION" 2>/dev/null \
  | python3 -c "
import sys,json,subprocess
try: vs=json.load(sys.stdin) or []
except: vs=[]
for v in vs:
    subprocess.run(['aws','s3api','delete-object','--bucket','$STATE_BUCKET','--key',v['Key'],'--version-id',v['VersionId'],'--region','$SB_REGION'])
    print('   deleted version', v['VersionId'])
"
# also delete any delete-markers
aws s3api list-object-versions --bucket "$STATE_BUCKET" --prefix "$STATE_KEY" \
  --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output json --region "$SB_REGION" 2>/dev/null \
  | python3 -c "
import sys,json,subprocess
try: vs=json.load(sys.stdin) or []
except: vs=[]
for v in vs:
    subprocess.run(['aws','s3api','delete-object','--bucket','$STATE_BUCKET','--key',v['Key'],'--version-id',v['VersionId'],'--region','$SB_REGION'])
"
aws s3 rm "s3://${STATE_BUCKET}/${STATE_KEY}" --region "$SB_REGION" 2>/dev/null || true
echo "   ✓ state file cleared"

# ── Clear the DynamoDB lock table digest + any leftover lock ─────────
# Deleting the S3 state leaves a stale checksum in DynamoDB, which makes
# the next run fail with "checksum ... does not match". Remove both the
# -md5 digest and any lock entry.
echo "▶ 1b. Clearing DynamoDB digest + lock for this state..."
LOCK_TABLE="rusto-tflock"
for suffix in "-md5" ""; do
  aws dynamodb delete-item \
    --table-name "$LOCK_TABLE" \
    --key "{\"LockID\":{\"S\":\"${STATE_BUCKET}/${STATE_KEY}${suffix}\"}}" \
    --region "$SB_REGION" 2>/dev/null \
    && echo "   ✓ removed ${STATE_KEY}${suffix}" || true
done

echo ""
echo "▶ 2. Deleting orphaned resources in us-east-1..."

# 2a. the orphaned uploads bucket
for b in $(aws s3api list-buckets --query "Buckets[?starts_with(Name,'rusto-production-uploads')].Name" --output text 2>/dev/null); do
  LOC=$(aws s3api get-bucket-location --bucket "$b" --query LocationConstraint --output text 2>/dev/null || echo "None")
  [ "$LOC" = "None" ] && LOC="us-east-1"
  if [ "$LOC" = "us-east-1" ]; then
    echo "   emptying + deleting bucket $b ..."
    aws s3 rm "s3://$b" --recursive --region us-east-1 2>/dev/null || true
    aws s3api delete-bucket --bucket "$b" --region us-east-1 2>/dev/null && echo "   ✓ deleted $b" || echo "   (delete $b by hand if it lingers)"
  fi
done

# 2b. ECR repos in us-east-1 (they'll be recreated in ap-south-1)
for repo in rusto-backend rusto-frontend; do
  aws ecr delete-repository --repository-name "$repo" --force --region us-east-1 >/dev/null 2>&1 \
    && echo "   ✓ deleted ECR $repo (us-east-1)" || true
done

# 2c. SSM params in us-east-1
for p in JWT_SECRET_KEY DEFAULT_ADMIN_PASSWORD DATABASE_URL; do
  aws ssm delete-parameter --name "/rusto/production/$p" --region us-east-1 >/dev/null 2>&1 \
    && echo "   ✓ deleted SSM /rusto/production/$p (us-east-1)" || true
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓ DONE. State cleared + us-east-1 orphans removed."
echo ""
echo "  NOTE: the VPC/subnets/IAM in us-east-1 (if any) are harmless —"
echo "  they cost nothing and are ignored now that state is gone. You can"
echo "  delete them later in the console if you want a tidy account."
echo ""
echo "  Now: make sure infra/envs/production.tfvars says"
echo "       aws_region = \"ap-south-1\", commit/push, and re-run the pipeline."
echo "  It will build fresh in ap-south-1."
echo "════════════════════════════════════════════════════════════"
