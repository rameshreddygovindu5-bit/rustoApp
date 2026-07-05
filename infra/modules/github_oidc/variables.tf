variable "project" {
  description = "Project slug"
  type        = string
  default     = "rusto"
}

variable "github_repo" {
  description = "GitHub repo in owner/name form, e.g. my-org/rusto"
  type        = string
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC provider. Set false if the account already has one."
  type        = bool
  default     = true
}
