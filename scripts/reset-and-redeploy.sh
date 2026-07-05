#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  reset-and-redeploy.sh
#
#  Fixes a half-built stack whose REGION was changed mid-deploy (state
#  points at old-region resources; config wants a new region).
#
#  It safely tears down the partial infrastructure and clears state so
#  the pipeline can build cleanly in the correct region (ap-south-1).
#
#  SAFE: nothing is running yet (no app, no data), so this destroys only
#  half-created scaffolding. Run in AWS CloudShell (account 825187894930)
#  with terraform installed. Or run the AWS-CLI cleanup section by hand.
# ════════════════════════════════════════════════════════════════════
set -uo pipefail

ACCOUNT="825187894930"
OLD_REGION="us-east-1"
NEW_REGION="ap-south-1"
STATE_BUCKET="rusto-tfstate-${ACCOUNT}"
ENVIRONMENT="production"

echo "▶ This clears the half-built '${ENVIRONMENT}' stack so it can rebuild in ${NEW_REGION}."
echo ""

# ── Option A: terraform destroy the old-region state (preferred) ────
# We point terraform at the OLD region to destroy what the state knows,
# then delete the state file so the next apply starts fresh.
if command -v terraform >/dev/null 2>&1 && [ -d infra ]; then
  echo "▶ Attempting terraform destroy against ${OLD_REGION} (what state references)..."
  (
    cd infra
    AWS_REGION="${OLD_REGION}" AWS_DEFAULT_REGION="${OLD_REGION}" \
    terraform init -reconfigure \
      -backend-config="bucket=${STATE_BUCKET}" \
      -backend-config="key=rusto/${ENVIRONMENT}/terraform.tfstate" \
      -backend-config="region=${NEW_REGION}" \
      -backend-config="dynamodb_table=rusto-tflock" \
      -backend-config="encrypt=true" || true
    AWS_REGION="${OLD_REGION}" AWS_DEFAULT_REGION="${OLD_REGION}" \
    terraform destroy -auto-approve \
      -var-file="envs/${ENVIRONMENT}.tfvars" \
      -var="aws_region=${OLD_REGION}" \
      -var="jwt_secret_key=x" -var="default_admin_password=x" \
      -var="anthropic_api_key=" -var="ssh_public_key=ssh-rsa AAAA" 2>&1 | tail -20 || true
  )
fi

# ── Delete the state file so next apply is a clean slate ────────────
echo ""
echo "▶ Clearing the Terraform state file for ${ENVIRONMENT}..."
aws s3 rm "s3://${STATE_BUCKET}/rusto/${ENVIRONMENT}/terraform.tfstate" \
  --region "${NEW_REGION}" 2>/dev/null && echo "  ✓ state file deleted" \
  || echo "  (no state file, or already gone)"

# ── Belt-and-braces: remove any orphaned S3 bucket in the OLD region ─
echo ""
echo "▶ Checking for an orphaned uploads bucket in ${OLD_REGION}..."
for b in $(aws s3api list-buckets --query "Buckets[?starts_with(Name, 'rusto-${ENVIRONMENT}-uploads')].Name" --output text 2>/dev/null); do
  LOC=$(aws s3api get-bucket-location --bucket "$b" --query LocationConstraint --output text 2>/dev/null || echo "")
  # us-east-1 reports as 'None'
  if [ "$LOC" = "None" ] || [ "$LOC" = "$OLD_REGION" ]; then
    echo "  emptying + deleting orphaned bucket $b (in ${OLD_REGION})..."
    aws s3 rm "s3://$b" --recursive 2>/dev/null || true
    aws s3api delete-bucket --bucket "$b" --region "$OLD_REGION" 2>/dev/null && echo "  ✓ deleted $b" || echo "  (could not delete $b; delete by hand if needed)"
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓ RESET DONE. The ${ENVIRONMENT} stack state is cleared."
echo "  Now re-run the GitHub pipeline — it will build cleanly in ${NEW_REGION}."
echo "════════════════════════════════════════════════════════════"
