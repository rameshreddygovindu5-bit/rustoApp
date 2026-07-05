# ════════════════════════════════════════════════════════════════════
#  Outputs. These are what the CI pipeline reads to configure the app —
#  the bridge between "infra Terraform created" and "config the app uses".
#  Because they come straight from the resources, they are always correct.
# ════════════════════════════════════════════════════════════════════

output "app_public_ip" {
  description = "Elastic IP of the app server"
  value       = module.compute.public_ip
}

output "instance_id" {
  description = "EC2 instance ID (for SSM Session Manager)"
  value       = module.compute.instance_id
}

output "backend_repo_url" {
  description = "ECR repository URL for the backend image"
  value       = module.registry.backend_repo_url
}

output "frontend_repo_url" {
  description = "ECR repository URL for the frontend image"
  value       = module.registry.frontend_repo_url
}

output "uploads_bucket" {
  description = "S3 bucket name for customer uploads"
  value       = module.storage.bucket_name
}

output "rds_endpoint" {
  description = "RDS endpoint host"
  value       = module.database.endpoint
}

output "db_port" {
  description = "Database port"
  value       = module.database.port
}

output "db_name" {
  description = "Database name"
  value       = module.database.db_name
}

output "db_username" {
  description = "Database master username"
  value       = module.database.username
}

output "ssm_prefix" {
  description = "SSM Parameter Store path prefix for this env's secrets"
  value       = module.secrets.ssm_prefix
}

output "aws_region" {
  description = "Region everything is deployed in"
  value       = var.aws_region
}

# Convenience: the exact values to put in the app's .env on the box.
# DATABASE_URL and secrets are NOT here — those live in SSM and are read
# at runtime, never exposed as plaintext outputs.
output "app_env_nonsecret" {
  description = "Non-secret app config derived from infra"
  value = {
    STORAGE_BACKEND = "s3"
    S3_BUCKET       = module.storage.bucket_name
    S3_PREFIX       = "${var.environment}/"
    AWS_REGION      = var.aws_region
    CORS_ORIGINS    = var.cors_origins
    BACKEND_IMAGE   = "${module.registry.backend_repo_url}:latest"
    FRONTEND_IMAGE  = "${module.registry.frontend_repo_url}:latest"
  }
}

# CORS origins as a standalone output so the deploy pipeline can inject it
# into the app's .env (it's non-secret config, so it does not go in SSM).
output "cors_origins" {
  description = "Allowed CORS origins for the app"
  value       = var.cors_origins
}
