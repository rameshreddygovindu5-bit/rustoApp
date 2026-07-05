# Non-secret, environment-specific values for STAGING.
# Secrets (jwt_secret_key, default_admin_password, anthropic_api_key) are
# NOT here — they are passed at apply time via TF_VAR_* in the pipeline.

aws_region  = "ap-south-1"
environment = "staging"

vpc_cidr      = "10.41.0.0/16"
instance_type = "t3.small"

db_instance_class        = "db.t4g.micro"
db_allocated_storage     = 20
db_engine_version        = "16"
db_name                  = "rusto_lms_staging"
db_username              = "lms_admin"
db_backup_retention_days = 7

# Lock this down to your office/home IP for real use, e.g. "203.0.113.4/32".
admin_ingress_cidr = "0.0.0.0/0"

cors_origins     = "https://staging.your-domain.example.com"
production_grade = false
