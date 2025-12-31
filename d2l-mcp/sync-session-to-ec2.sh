#!/bin/bash
# Sync D2L session to EC2 automatically

set -e

EC2_HOST="ec2-user@3.93.185.101"
KEY_PATH="~/.ssh/PokeIntegrations"

echo "🔄 Syncing D2L session to EC2..."

# Check if local session exists
if [ ! -d ~/.d2l-session ]; then
    echo "❌ No local session found. Run 'npm run auth' first."
    exit 1
fi

# Create fresh tar without macOS metadata
echo "📦 Creating session archive..."
cd ~
tar --exclude='.DS_Store' -czf /tmp/d2l-session.tar.gz .d2l-session/

# Sync to EC2
echo "⬆️  Uploading to EC2..."
rsync -avz -e "ssh -i $KEY_PATH" /tmp/d2l-session.tar.gz $EC2_HOST:~/

# Extract on EC2
echo "📂 Extracting on EC2..."
ssh -i $KEY_PATH $EC2_HOST "cd ~ && tar -xzf d2l-session.tar.gz && rm d2l-session.tar.gz"

# Clean up
rm /tmp/d2l-session.tar.gz

echo "✅ Session synced successfully!"
echo ""
echo "To restart the server on EC2:"
echo "  ssh -i $KEY_PATH $EC2_HOST"
echo "  pm2 restart d2l-mcp"
