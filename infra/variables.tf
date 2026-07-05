# ════════════════════════════════════════════════════════════════════
#  Root input variables. Values come from per-environment .tfvars files
#  (envs/staging.tfvars, envs/production.tfvars) — never hardcoded here.
# ════════════════════════════════════════════════════════════════════

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}

variable "environment" {
  description = "Target name — a label for this deployment (e.g. staging, production, dev, client-a, demo). Used to name/prefix resources, the state key, and the SSM path. Any lowercase slug is valid."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.environment))
    error_message = "environment must be a lowercase slug: start with a letter, then letters/digits/hyphens, 2-31 chars (e.g. staging, dev, client-a)."
  }
}

variable "project" {
  description = "Project slug used to name/prefix resources"
  type        = string
  default     = "rusto"
}

# ── Networking ──────────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

# ── Compute (EC2) ───────────────────────────────────────────────────
variable "instance_type" {
  description = "EC2 instance type for the app server"
  type        = string
  # staging overrides to t3.small; production to t3.medium via tfvars
  default = "t3.small"
}

variable "ssh_public_key" {
  description = "SSH public key material for EC2 admin access (the matching private key is used by the deploy pipeline). Provide via TF_VAR_ssh_public_key or tfvars — never commit the private key."
  type        = string
}

variable "admin_ingress_cidr" {
  description = "CIDR allowed to SSH to the instance (e.g. your office IP/32). Use 0.0.0.0/0 only if you must, and prefer SSM Session Manager instead."
  type        = string
  default     = "0.0.0.0/0"
}

# ── Database (RDS) ──────────────────────────────────────────────────
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS storage in GB"
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "16.4"
}

variable "db_name" {
  description = "Application database name"
  type        = string
  default     = "rusto_lms"
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  default     = "lms_admin"
}

variable "db_backup_retention_days" {
  description = "Automated backup retention window in days"
  type        = number
  default     = 7
}

# ── Application secrets (seeded into SSM Parameter Store) ────────────
# These are provided at apply time (via TF_VAR_… env vars in the pipeline)
# and written to SSM as SecureString. The app reads them from SSM at
# runtime — they are never baked into images or committed.
variable "jwt_secret_key" {
  description = "JWT signing secret for the app"
  type        = string
  sensitive   = true
}

variable "default_admin_password" {
  description = "First-boot admin password for the app"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Optional Anthropic API key for the AI agent"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cors_origins" {
  description = "Comma-separated allowed CORS origins for the app"
  type        = string
  default     = "*"
}

variable "production_grade" {
  description = "Enable production-grade DB settings (multi-AZ, deletion protection, final snapshot) for THIS target, regardless of its name. Set true in the tfvars of any target that holds real data."
  type        = bool
  default     = false
}
