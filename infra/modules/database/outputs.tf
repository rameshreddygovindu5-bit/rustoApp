output "endpoint" {
  value = aws_db_instance.this.address
}
output "port" {
  value = aws_db_instance.this.port
}
output "db_name" {
  value = aws_db_instance.this.db_name
}
output "username" {
  value = aws_db_instance.this.username
}
output "password" {
  value     = random_password.db.result
  sensitive = true
}
# Full connection string the app uses — assembled here so it's the ONE
# source of truth and injected into SSM.
output "database_url" {
  value     = "postgresql://${aws_db_instance.this.username}:${random_password.db.result}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${aws_db_instance.this.db_name}"
  sensitive = true
}
