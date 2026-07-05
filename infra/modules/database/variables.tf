variable "project" {
  description = "Project slug used to name and prefix resources"
  type        = string
}
variable "environment" {
  description = "Target/environment name for this deployment"
  type        = string
}
variable "private_subnet_ids" {
  description = "IDs of the private subnets for the database"
  type        = list(string)
}
variable "rds_sg_id" {
  description = "Security group ID for the RDS instance"
  type        = string
}
variable "instance_class" {
  description = "RDS instance class"
  type        = string
}
variable "allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
}
variable "engine_version" {
  description = "PostgreSQL engine version"
  type        = string
}
variable "db_name" {
  description = "Application database name"
  type        = string
}
variable "db_username" {
  description = "RDS master username"
  type        = string
}
variable "backup_retention_days" {
  description = "Automated backup retention window in days"
  type        = number
}

variable "production_grade" {
  description = "Enable production-grade settings (multi-AZ, deletion protection, final snapshot). Any target can opt in regardless of name."
  type        = bool
  default     = false
}
