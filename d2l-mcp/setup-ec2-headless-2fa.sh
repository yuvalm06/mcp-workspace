#!/bin/bash
# Setup script for EC2 to enable headless 2FA with screenshots

echo "Installing dependencies..."
sudo yum install -y xorg-x11-server-Xvfb scrot ImageMagick || \
sudo apt-get install -y xvfb scrot imagemagick

echo ""
echo "✅ Setup complete!"
echo ""
echo "To authenticate on EC2 with 2FA:"
echo ""
echo "1. Start virtual display:"
echo "   export DISPLAY=:99"
echo "   Xvfb :99 -screen 0 1280x720x24 &"
echo ""
echo "2. Run auth:"
echo "   cd ~/d2l-mcp"
echo "   npm run auth"
echo ""
echo "3. In another terminal, take screenshots to see 2FA code:"
echo "   DISPLAY=:99 scrot /tmp/auth-screenshot.png"
echo "   # Download to view:"
echo "   scp -i ~/.ssh/PokeIntegrations ec2-user@3.93.185.101:/tmp/auth-screenshot.png ."
echo ""
echo "4. Repeat step 3 until you see the 2FA page, then enter code in terminal"
