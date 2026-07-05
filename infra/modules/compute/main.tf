# ════════════════════════════════════════════════════════════════════
#  Compute: IAM role + instance profile, EC2 app server, Elastic IP.
#
#  The instance role grants exactly what the app needs and nothing more:
#    • ECR read      → pull images
#    • S3 access     → read/write customer uploads in THIS bucket only
#    • SSM read      → fetch secrets under /{project}/{environment}/*
#    • SSM Managed   → allows Session Manager (SSH-less shell) for admin
#
#  No AWS keys ever live on the box or in the app — the role is the auth.
# ════════════════════════════════════════════════════════════════════

locals {
  name = "${var.project}-${var.environment}"
}

# ── AMI: latest Ubuntu 22.04 LTS (Canonical) ────────────────────────
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── IAM role for the instance ───────────────────────────────────────
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${local.name}-instance-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# ECR read (pull images)
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# SSM Session Manager (SSH-less admin access)
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Scoped S3 access to the uploads bucket only
data "aws_iam_policy_document" "s3" {
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket"]
    resources = [var.uploads_bucket_arn]
  }
  statement {
    sid       = "ObjectRW"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.uploads_bucket_arn}/*"]
  }
}

resource "aws_iam_role_policy" "s3" {
  name   = "${local.name}-s3"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.s3.json
}

# Scoped SSM read for this env's parameters + KMS decrypt for SecureString
data "aws_iam_policy_document" "ssm" {
  statement {
    sid     = "ReadParams"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/${var.project}/${var.environment}/*"
    ]
  }
  statement {
    sid       = "DecryptSecureString"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.aws_region}:${var.account_id}:alias/aws/ssm"]
  }
}

resource "aws_iam_role_policy" "ssm" {
  name   = "${local.name}-ssm"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.ssm.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${local.name}-instance-profile"
  role = aws_iam_role.instance.name
}

# ── SSH key pair ────────────────────────────────────────────────────
resource "aws_key_pair" "this" {
  key_name   = "${local.name}-key"
  public_key = var.ssh_public_key
}

# ── EC2 instance ────────────────────────────────────────────────────
resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = var.public_subnet_id
  vpc_security_group_ids = [var.app_sg_id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  key_name               = aws_key_pair.this.key_name

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  # user_data installs Docker, the AWS CLI, swap, and the ECR-login timer.
  # The app deploy itself is done by the CI pipeline afterwards.
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    aws_region = var.aws_region
  })

  tags = { Name = "${local.name}-app" }

  lifecycle {
    ignore_changes = [ami] # don't force-replace when a newer AMI appears
  }
}

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "${local.name}-eip" }
}
