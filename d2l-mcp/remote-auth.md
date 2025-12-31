# Remote Authentication Setup for EC2

## Problem
2FA requires viewing the browser, but EC2 has no display.

## Solution 1: Copy Local Session (Easiest)

1. **Authenticate locally** (complete 2FA on your machine):
   ```bash
   npm run auth
   ```

2. **Package the session**:
   ```bash
   tar -czf d2l-session.tar.gz -C ~ .d2l-session
   ```

3. **Copy to EC2**:
   ```bash
   scp -i your-key.pem d2l-session.tar.gz ec2-user@your-ec2-ip:~/
   ```

4. **Extract on EC2**:
   ```bash
   ssh -i your-key.pem ec2-user@your-ec2-ip
   cd ~
   tar -xzf d2l-session.tar.gz
   cd d2l-mcp
   npm start
   ```

## Solution 2: Remote Browser with Chrome DevTools Protocol

1. **On EC2**, install X virtual framebuffer:
   ```bash
   sudo apt install -y xvfb
   ```

2. **Set display environment**:
   ```bash
   export DISPLAY=:99
   Xvfb :99 -screen 0 1280x720x24 &
   ```

3. **Run auth**:
   ```bash
   npm run auth
   ```

4. **Take screenshot to see 2FA code**:
   ```bash
   sudo apt install -y scrot
   DISPLAY=:99 scrot screenshot.png
   ```

5. **Download screenshot**:
   ```bash
   scp -i your-key.pem ec2-user@your-ec2-ip:~/screenshot.png .
   ```

## Solution 3: Use "Trust This Device" Option

If your university's 2FA has a "Trust this device for X days" option:

1. Authenticate once using Solution 1 or 2
2. Check the "Trust this device" checkbox during 2FA
3. Session will last longer without requiring 2FA again

## Maintenance Schedule

- Session expires: ~24 hours
- Token cache: 23 hours
- Set up a daily cron job to copy fresh session from local machine, OR
- Re-authenticate manually once every few days using Solution 1

## Automated Session Refresh (Advanced)

Create a script on your local machine to automatically sync sessions:

```bash
#!/bin/bash
# sync-session.sh
tar -czf /tmp/d2l-session.tar.gz -C ~ .d2l-session
scp -i ~/.ssh/your-key.pem /tmp/d2l-session.tar.gz ec2-user@your-ec2-ip:~/
ssh -i ~/.ssh/your-key.pem ec2-user@your-ec2-ip "cd ~ && tar -xzf d2l-session.tar.gz && pm2 restart d2l-mcp"
rm /tmp/d2l-session.tar.gz
```

Run with cron daily:
```bash
crontab -e
# Add: 0 3 * * * /path/to/sync-session.sh
```
