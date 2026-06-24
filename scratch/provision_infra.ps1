# provision_infra.ps1
# Automates the creation of a complete VPC + Subnet + Internet Gateway + Route Table + Security Group + Key Pair + t3.medium EC2 instance.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scratch\provision_infra.ps1

$ErrorActionPreference = "Stop"

# 1. Configuration
$REGION = "us-east-1"
$VPC_CIDR = "10.0.0.0/16"
$SUBNET_CIDR = "10.0.1.0/24"
$INSTANCE_TYPE = "t3.medium"
$KEY_NAME = "rusto-lms-key"
$SG_NAME = "rusto-lms-sg"
$TAG_NAME = "Rusto-LMS-Server"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Rusto LMS - AWS Infrastructure Provisioner" -ForegroundColor Cyan
Write-Host "  Region: $REGION" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Check AWS credentials
Write-Host "`n>> Checking AWS credentials..." -ForegroundColor Yellow
try {
    $identity = aws sts get-caller-identity --output json | ConvertFrom-Json
    Write-Host "✓ Authenticated as: $($identity.Arn)" -ForegroundColor Green
} catch {
    Write-Error "Failed to authenticate with AWS CLI. Please run 'aws configure' first or set your AWS environment variables."
}

# 2. Network Provisioning
Write-Host "`n>> Creating VPC ($VPC_CIDR)..." -ForegroundColor Yellow
$vpc = aws ec2 create-vpc --cidr-block $VPC_CIDR --query "Vpc.VpcId" --output text
Write-Host "✓ VPC Created: $vpc" -ForegroundColor Green

# Enable DNS support & hostnames
aws ec2 modify-vpc-attribute --vpc-id $vpc --enable-dns-support '{"Value":true}'
aws ec2 modify-vpc-attribute --vpc-id $vpc --enable-dns-hostnames '{"Value":true}'

Write-Host "`n>> Creating Internet Gateway..." -ForegroundColor Yellow
$igw = aws ec2 create-internet-gateway --query "InternetGateway.InternetGatewayId" --output text
Write-Host "✓ IGW Created: $igw" -ForegroundColor Green

aws ec2 attach-internet-gateway --vpc-id $vpc --internet-gateway-id $igw
Write-Host "✓ Attached IGW to VPC" -ForegroundColor Green

Write-Host "`n>> Creating Subnet ($SUBNET_CIDR)..." -ForegroundColor Yellow
$subnet = aws ec2 create-subnet --vpc-id $vpc --cidr-block $SUBNET_CIDR --query "Subnet.SubnetId" --output text
Write-Host "✓ Subnet Created: $subnet" -ForegroundColor Green

# Enable public IP on launch
aws ec2 modify-subnet-attribute --subnet-id $subnet --map-public-ip-on-launch

Write-Host "`n>> Creating Route Table..." -ForegroundColor Yellow
$rt = aws ec2 create-route-table --vpc-id $vpc --query "RouteTable.RouteTableId" --output text
Write-Host "✓ Route Table Created: $rt" -ForegroundColor Green

# Create route to internet
aws ec2 create-route --route-table-id $rt --destination-cidr-block 0.0.0.0/0 --gateway-id $igw | Out-Null
Write-Host "✓ Created route to 0.0.0.0/0 via IGW" -ForegroundColor Green

# Associate subnet with route table
aws ec2 associate-route-table --subnet-id $subnet --route-table-id $rt | Out-Null
Write-Host "✓ Associated subnet with Route Table" -ForegroundColor Green

# 3. Security Group
Write-Host "`n>> Creating Security Group ($SG_NAME)..." -ForegroundColor Yellow
$sg = aws ec2 create-security-group --group-name $SG_NAME --description "Rusto LMS Security Group" --vpc-id $vpc --query "GroupId" --output text
Write-Host "✓ Security Group Created: $sg" -ForegroundColor Green

# Authorize SSH, HTTP, HTTPS
Write-Host ">> Configuring firewall rules (Ports: 22, 80, 443)..." -ForegroundColor Yellow
aws ec2 authorize-security-group-ingress --group-id $sg --protocol tcp --port 22 --cidr 0.0.0.0/0 | Out-Null
aws ec2 authorize-security-group-ingress --group-id $sg --protocol tcp --port 80 --cidr 0.0.0.0/0 | Out-Null
aws ec2 authorize-security-group-ingress --group-id $sg --protocol tcp --port 443 --cidr 0.0.0.0/0 | Out-Null
Write-Host "✓ Configured inbound ports 22, 80, 443 from anywhere" -ForegroundColor Green

# 4. Key Pair Creation
Write-Host "`n>> Creating SSH Key Pair ($KEY_NAME)..." -ForegroundColor Yellow
$keyPath = Join-Path $PSScriptRoot "rusto-lms-key.pem"
if (Test-Path $keyPath) {
    Remove-Item $keyPath -Force
}
$keyMaterial = aws ec2 create-key-pair --key-name $KEY_NAME --query "KeyMaterial" --output text
$keyMaterial | Out-File -FilePath $keyPath -Encoding ascii
Write-Host "✓ Created Key Pair and saved private key to: $keyPath" -ForegroundColor Green

# 5. Fetch Latest Ubuntu 22.04 AMI ID
Write-Host "`n>> Fetching latest Ubuntu 22.04 LTS AMI ID..." -ForegroundColor Yellow
$ami = aws ec2 describe-images --owners 099720109477 --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" "Name=state,Values=available" --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text
Write-Host "✓ Selected AMI: $ami" -ForegroundColor Green

# 6. Launch EC2 Instance
Write-Host "`n>> Launching $INSTANCE_TYPE instance ($TAG_NAME)..." -ForegroundColor Yellow
$blockDeviceMapping = '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]'
$instanceId = aws ec2 run-instances `
    --image-id $ami `
    --count 1 `
    --instance-type $INSTANCE_TYPE `
    --key-name $KEY_NAME `
    --security-group-ids $sg `
    --subnet-id $subnet `
    --block-device-mappings $blockDeviceMapping `
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$TAG_NAME}]" `
    --query "Instances[0].InstanceId" `
    --output text

Write-Host "✓ Instance launched: $instanceId" -ForegroundColor Green

# 7. Wait for Running State
Write-Host ">> Waiting for instance to be running (this can take 30-60 seconds)..." -ForegroundColor Yellow
$status = ""
while ($status -ne "running") {
    Start-Sleep -Seconds 5
    $status = aws ec2 describe-instances --instance-ids $instanceId --query "Reservations[0].Instances[0].State.Name" --output text
    Write-Host "   Status: $status" -ForegroundColor Gray
}

# Get public IP
$ip = aws ec2 describe-instances --instance-ids $instanceId --query "Reservations[0].Instances[0].PublicIpAddress" --output text
$dns = aws ec2 describe-instances --instance-ids $instanceId --query "Reservations[0].Instances[0].PublicDnsName" --output text

Write-Host "`n✓ Infrastructure successfully created!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  IP Address (EC2_HOST): $ip" -ForegroundColor Cyan
Write-Host "  Public DNS Name:       $dns" -ForegroundColor Cyan
Write-Host "  SSH User (EC2_USER):  ubuntu" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 8. Output exact GitHub Secrets content
$pemContent = Get-Content $keyPath -Raw
Write-Host "`n>>> COPY THE DETAILS BELOW INTO YOUR GITHUB SECRETS <<<" -ForegroundColor White

Write-Host "`n1. Name: EC2_HOST" -ForegroundColor Green
Write-Host "   Value: $ip" -ForegroundColor White

Write-Host "`n2. Name: EC2_USER" -ForegroundColor Green
Write-Host "   Value: ubuntu" -ForegroundColor White

Write-Host "`n3. Name: EC2_SSH_KEY" -ForegroundColor Green
Write-Host "   Value:" -ForegroundColor Green
Write-Host $pemContent -ForegroundColor White
Write-Host "=============================================" -ForegroundColor Cyan
