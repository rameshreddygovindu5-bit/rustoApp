output "backend_repo_url" {
  description = "ECR URL for the backend image repository"
  value       = "${local.registry}/${var.project}-backend"
}

output "frontend_repo_url" {
  description = "ECR URL for the frontend image repository"
  value       = "${local.registry}/${var.project}-frontend"
}
