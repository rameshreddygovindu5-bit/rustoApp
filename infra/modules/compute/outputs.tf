output "public_ip" {
  value = aws_eip.app.public_ip
}
output "instance_id" {
  value = aws_instance.app.id
}
output "instance_role_arn" {
  value = aws_iam_role.instance.arn
}
