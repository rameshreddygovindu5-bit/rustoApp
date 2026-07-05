variable "project" {
  description = "Project slug used to name and prefix resources"
  type        = string
}
variable "environment" {
  description = "Target/environment name for this deployment"
  type        = string
}
variable "suffix" {
  description = "Random suffix for global uniqueness"
  type        = string
}
