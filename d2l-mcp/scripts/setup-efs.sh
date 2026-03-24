#!/bin/bash
# setup-efs.sh — Run once to create EFS filesystem for d2l sessions
# Usage: bash scripts/setup-efs.sh
# Prereq: AWS CLI configured, ECS task security group ID known

set -e

REGION="us-east-1"
VPC_ID=$(aws ec2 describe-vpcs --region $REGION --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
SUBNET_IDS=$(aws ec2 describe-subnets --region $REGION --filters "Name=vpc-id,Values=$VPC_ID" --query "Subnets[*].SubnetId" --output text)
SECURITY_GROUP=$(aws ec2 describe-security-groups --region $REGION --filters "Name=group-name,Values=study-mcp-sg" --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "")

echo "VPC: $VPC_ID"
echo "Subnets: $SUBNET_IDS"

# Create EFS filesystem
echo "Creating EFS filesystem..."
EFS_ID=$(aws efs create-file-system \
  --region $REGION \
  --performance-mode generalPurpose \
  --throughput-mode bursting \
  --encrypted \
  --tags "Key=Name,Value=d2l-sessions" \
  --query "FileSystemId" \
  --output text)

echo "EFS created: $EFS_ID"

# Wait for EFS to be available
echo "Waiting for EFS to become available..."
aws efs wait file-system-available --file-system-id $EFS_ID --region $REGION || sleep 10

# Create mount targets in each subnet
for SUBNET in $SUBNET_IDS; do
  echo "Creating mount target in subnet $SUBNET..."
  aws efs create-mount-target \
    --region $REGION \
    --file-system-id $EFS_ID \
    --subnet-id $SUBNET \
    ${SECURITY_GROUP:+--security-groups $SECURITY_GROUP} \
    2>/dev/null || echo "  (mount target may already exist)"
done

# Create /sessions directory via access point
echo "Creating EFS access point for /sessions..."
aws efs create-access-point \
  --region $REGION \
  --file-system-id $EFS_ID \
  --root-directory "Path=/sessions,CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=755}" \
  --tags "Key=Name,Value=d2l-sessions-ap"

echo ""
echo "============================="
echo "EFS setup complete!"
echo "EFS ID: $EFS_ID"
echo ""
echo "NEXT STEP: Update task-definition.json"
echo "Replace REPLACE_WITH_EFS_ID with: $EFS_ID"
echo "============================="
