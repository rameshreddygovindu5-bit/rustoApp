#!/bin/env bash
# bootstrap_instance.sh
# Connects to your newly launched EC2 instance and runs the bootstrap setup.
# Usage:
#   ./bootstrap_instance.sh <EC2_HOST_IP> <PATH_TO_PRIVATE_KEY_PEM>
# Example:
#   ./bootstrap_instance.sh 13.207.0.235 ./rusto-lms-key.pem

set -euo pipefail

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <EC2_HOST_IP> <PATH_TO_PRIVATE_KEY_PEM>"
    exit 1
fi

EC2_HOST="$1"
KEY_PATH="$2"

echo "============================================="
echo "  Rusto LMS - EC2 Remote Bootstrapper"
echo "  Target Host: $EC2_HOST"
echo "  SSH Key:     $KEY_PATH"
echo "============================================="

# Ensure correct permissions on the private key
chmod 400 "$KEY_PATH" 2>/dev/null || true

echo ">> Connecting to $EC2_HOST and running ec2-bootstrap.sh..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "ubuntu@$EC2_HOST" \
  "curl -fsSL https://raw.githubusercontent.com/rameshreddygovindu5-bit/rustoApp/master/ec2-bootstrap.sh | bash"

echo -e "\n✓ Remote bootstrap finished successfully!"
