output "deploy_role_arn" {
  description = "ARN of the role GitHub Actions assumes (contains the account ID)"
  value       = aws_iam_role.deploy.arn
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}
