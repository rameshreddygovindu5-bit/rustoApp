variable "project" {
  description = "Project slug used to name and prefix resources"
  type        = string
}
variable "environment" {
  description = "Target/environment name for this deployment"
  type        = string
}
variable "vpc_id" {
  description = "ID of the VPC to create resources in"
  type        = string
}
variable "admin_ingress_cidr" {
  description = "CIDR allowed to SSH to the app server"
  type        = string
}
