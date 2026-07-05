variable "project" {
  description = "Project slug used to name and prefix resources"
  type        = string
}
variable "environment" {
  description = "Target/environment name for this deployment"
  type        = string
}
variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}
variable "account_id" {
  description = "AWS account ID (used to scope IAM/ARNs)"
  type        = string
}
variable "instance_type" {
  description = "EC2 instance type for the app server"
  type        = string
}
variable "public_subnet_id" {
  description = "ID of the public subnet to place the app server in"
  type        = string
}
variable "app_sg_id" {
  description = "Security group ID for the app server"
  type        = string
}
variable "ssh_public_key" {
  description = "SSH public key material for EC2 admin access"
  type        = string
}
variable "uploads_bucket_arn" {
  description = "ARN of the S3 uploads bucket the instance may access"
  type        = string
}
