variable "project" {
  description = "Project slug used to name and prefix resources"
  type        = string
}
variable "environment" {
  description = "Target/environment name for this deployment"
  type        = string
}
variable "database_url" {
  description = "Full Postgres connection string (written to SSM)"
  type        = string
  sensitive   = true
}
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
