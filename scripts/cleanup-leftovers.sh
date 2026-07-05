#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  cleanup-leftovers.sh — remove resources that exist in AWS but are no
#  longer in Terraform state (the "already exists" errors), so a fresh
#  apply can create them cleanly.
#
#  Run in AWS CloudShell (account 825187894930).
# ════════════════════════════════════════════════════════════════════
set -uo pipefail

REGION="ap-south-1"
ROLE="rusto-production-instance-role"
PROFILE="rusto-production-instance-profile"

echo "▶ Removing leftover IAM role $ROLE (and its dependencies)..."

# 1. Detach managed policies
for arn in $(aws iam list-attached-role-policies --role-name "$ROLE" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null); do
  aws iam detach-role-policy --role-name "$ROLE" --policy-arn "$arn" 2>/dev/null && echo "   detached $arn"
done

# 2. Delete inline policies
for pn in $(aws iam list-role-policies --role-name "$ROLE" --query 'PolicyNames[]' --output text 2>/dev/null); do
  aws iam delete-role-policy --role-name "$ROLE" --policy-name "$pn" 2>/dev/null && echo "   deleted inline policy $pn"
done

# 3. Remove role from instance profile, then delete the profile
aws iam remove-role-from-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE" 2>/dev/null && echo "   removed role from instance profile"
aws iam delete-instance-profile --instance-profile-name "$PROFILE" 2>/dev/null && echo "   deleted instance profile $PROFILE"

# 4. Delete the role
aws iam delete-role --role-name "$ROLE" 2>/dev/null && echo "   ✓ deleted role $ROLE" || echo "   (role already gone)"

echo ""
echo "▶ Removing leftover ECR repositories in $REGION..."
for repo in rusto-backend rusto-frontend; do
  aws ecr delete-repository --repository-name "$repo" --force --region "$REGION" >/dev/null 2>&1 \
    && echo "   ✓ deleted ECR $repo" || echo "   ($repo already gone)"
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✓ DONE. Leftover role + ECR repos removed."
echo "  Re-run the pipeline — Terraform will now create them cleanly."
echo "════════════════════════════════════════════════════════════"
