#!/bin/env bash
# launch_t4g_micro.sh
# Automates the creation of a complete t4g.micro (Graviton Free Tier) instance
# inside the public subnet subnet-08e2b4ae8a1e4d034 and security group sg-02b5b6a35173fce3b.
set -euo pipefail

SUBNET_ID="subnet-08e2b4ae8a1e4d034"
SG_ID="sg-02b5b6a35173fce3b"
KEY_NAME="rusto-lms-key"
INSTANCE_TYPE="t4g.micro"
TAG_NAME="Rusto-LMS-Server"

echo "============================================="
echo "  Launching t4g.micro Instance (Graviton Free Tier)"
echo "============================================="

# 1. Re-create Key Pair
echo -e "\n>> Creating SSH Key Pair ($KEY_NAME)..."
aws ec2 delete-key-pair --key-name "$KEY_NAME" || true
KEY_MATERIAL=$(aws ec2 create-key-pair --key-name "$KEY_NAME" --query "KeyMaterial" --output text)
echo "✓ Created Key Pair"

# 2. Fetch latest Ubuntu 22.04 LTS ARM64 AMI ID (required for t4g.micro)
echo -e "\n>> Fetching latest Ubuntu 22.04 LTS ARM64 AMI ID..."
AMI_ID=$(aws ec2 describe-images --owners 099720109477 --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*" "Name=state,Values=available" --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text)
echo "✓ Selected ARM64 AMI: $AMI_ID"

# 3. Launch the t4g.micro free tier instance
echo -e "\n>> Launching $INSTANCE_TYPE instance ($TAG_NAME)..."
BLOCK_DEVICE='[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]'
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --count 1 \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --subnet-id "$SUBNET_ID" \
    --block-device-mappings "$BLOCK_DEVICE" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$TAG_NAME}]" \
    --query "Instances[0].InstanceId" \
    --output text)

echo "✓ Instance launched: $INSTANCE_ID"

# 4. Wait for instance to be running
echo ">> Waiting for instance to be running (this can take 30-40 seconds)..."
STATUS=""
while [ "$STATUS" != "running" ]; do
    sleep 5
    STATUS=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].State.Name" --output text)
    echo "   Status: $STATUS"
done

IP_ADDR=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
DNS_NAME=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].PublicDnsName" --output text)

echo -e "\n✓ Infrastructure successfully created!"
echo "============================================="
echo "  IP Address (EC2_HOST): $IP_ADDR"
echo "  Public DNS Name:       $DNS_NAME"
echo "  SSH User (EC2_USER):  ubuntu"
echo "============================================="

echo -e "\n>>> COPY THE DETAILS BELOW INTO YOUR GITHUB SECRETS <<<"
echo -e "\n1. Name: EC2_HOST"
echo "   Value: $IP_ADDR"
echo -e "\n2. Name: EC2_USER"
echo "   Value: ubuntu"
echo -e "\n3. Name: EC2_SSH_KEY"
echo "   Value:"
echo "$KEY_MATERIAL"
echo "============================================="
