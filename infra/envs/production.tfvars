# Non-secret, environment-specific values for PRODUCTION.
# Secrets are passed at apply time via TF_VAR_* in the pipeline.
#
# NOTE: these values are FREE-TIER SAFE so a free-tier account can deploy.
# For a real production workload on a paid account, raise db_instance_class,
# db_allocated_storage, db_backup_retention_days, and set production_grade=true.

aws_region  = "ap-south-1"
environment = "production"

vpc_cidr      = "10.40.0.0/16"
instance_type = "t3.micro"

db_instance_class        = "db.t3.micro"
db_allocated_storage     = 20
db_engine_version        = "16"
db_name                  = "rusto_lms"
db_username              = "lms_admin"
db_backup_retention_days = 1

admin_ingress_cidr = "0.0.0.0/0"

cors_origins = "https://your-domain.example.com"

# Free tier can't do multi-AZ / some production-grade features, so keep false
# here. Flip to true on a paid account for multi-AZ + deletion protection.
production_grade = false
