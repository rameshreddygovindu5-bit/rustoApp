# ════════════════════════════════════════════════════════════════════
#  SSM Parameter Store SecureString parameters for app secrets.
#  The app reads these at runtime by path; nothing is baked into images
#  or committed. Path convention: /{project}/{environment}/{key}
# ════════════════════════════════════════════════════════════════════

locals {
  prefix = "/${var.project}/${var.environment}"
}

resource "aws_ssm_parameter" "database_url" {
  name        = "${local.prefix}/DATABASE_URL"
  description = "Full Postgres connection string for the app"
  type        = "SecureString"
  value       = var.database_url
}

resource "aws_ssm_parameter" "jwt_secret" {
  name        = "${local.prefix}/JWT_SECRET_KEY"
  description = "JWT signing secret"
  type        = "SecureString"
  value       = var.jwt_secret_key
}

resource "aws_ssm_parameter" "admin_password" {
  name        = "${local.prefix}/DEFAULT_ADMIN_PASSWORD"
  description = "First-boot admin password"
  type        = "SecureString"
  value       = var.default_admin_password
}

resource "aws_ssm_parameter" "anthropic_api_key" {
  count       = var.anthropic_api_key == "" ? 0 : 1
  name        = "${local.prefix}/ANTHROPIC_API_KEY"
  description = "Anthropic API key for the AI agent"
  type        = "SecureString"
  value       = var.anthropic_api_key
}
