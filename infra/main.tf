# ════════════════════════════════════════════════════════════════════
#  Root composition. Wires the modules together and passes each module's
#  outputs to the next — so the RDS endpoint, S3 bucket name, and ECR
#  URLs all flow from ONE source into the app config. Nothing is typed
#  twice, so nothing can drift.
# ════════════════════════════════════════════════════════════════════

data "aws_caller_identity" "current" {}

# Random suffix for globally-unique names (S3). Stable across applies.
resource "random_id" "suffix" {
  byte_length = 3
}

module "network" {
  source      = "./modules/network"
  project     = var.project
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
}

module "security" {
  source             = "./modules/security"
  project            = var.project
  environment        = var.environment
  vpc_id             = module.network.vpc_id
  admin_ingress_cidr = var.admin_ingress_cidr
}

module "storage" {
  source      = "./modules/storage"
  project     = var.project
  environment = var.environment
  suffix      = random_id.suffix.hex
}

module "registry" {
  source  = "./modules/registry"
  project = var.project
}

module "database" {
  source                = "./modules/database"
  project               = var.project
  environment           = var.environment
  private_subnet_ids    = module.network.private_subnet_ids
  rds_sg_id             = module.security.rds_sg_id
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  engine_version        = var.db_engine_version
  db_name               = var.db_name
  db_username           = var.db_username
  backup_retention_days = var.db_backup_retention_days
  production_grade      = var.production_grade
}

# Secrets: the DATABASE_URL is assembled by the database module and
# written to SSM here, alongside the app secrets. This is the single
# source of truth the app reads at runtime.
module "secrets" {
  source                 = "./modules/secrets"
  project                = var.project
  environment            = var.environment
  database_url           = module.database.database_url
  jwt_secret_key         = var.jwt_secret_key
  default_admin_password = var.default_admin_password
  anthropic_api_key      = var.anthropic_api_key
}

module "compute" {
  source             = "./modules/compute"
  project            = var.project
  environment        = var.environment
  aws_region         = var.aws_region
  account_id         = data.aws_caller_identity.current.account_id
  instance_type      = var.instance_type
  public_subnet_id   = module.network.public_subnet_ids[0]
  app_sg_id          = module.security.app_sg_id
  ssh_public_key     = var.ssh_public_key
  uploads_bucket_arn = module.storage.bucket_arn
}
