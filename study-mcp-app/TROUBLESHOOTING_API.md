# Troubleshooting API Connection Issues

## 502 Bad Gateway Error

This error means the app cannot connect to your backend API server.

### Common Causes

1. **Backend not running**
   - Make sure your MCP server is running with `MCP_TRANSPORT=http` or `MCP_TRANSPORT=https`
   - Check that it's listening on the expected port (default: 3000)

2. **Wrong API URL**
   - In development, the app defaults to `http://localhost:3000`
   - For physical devices or emulators, `localhost` won't work - use your computer's IP address
   - Set `EXPO_PUBLIC_API_BASE_URL` in your `.env` file

3. **Network/CORS issues**
   - Make sure CORS is enabled on your backend
   - Check firewall settings

### Solutions

#### For Development (iOS Simulator / Android Emulator)

If using iOS Simulator or Android Emulator, `localhost` should work. Make sure:
```bash
# In d2l-mcp directory
MCP_TRANSPORT=http npm start
# or
MCP_TRANSPORT=http node src/index.ts
```

#### For Physical Devices

You need to use your computer's IP address instead of `localhost`:

1. Find your computer's IP address:
   ```bash
   # macOS/Linux
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Or
   ipconfig getifaddr en0  # macOS
   ```

2. Set the API URL in your `.env` file:
   ```env
   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.XXX:3000
   ```
   (Replace `192.168.1.XXX` with your actual IP)

3. Restart Expo:
   ```bash
   # Stop current server (Ctrl+C)
   npm start
   ```

#### For Production

Set the production API URL:
```env
EXPO_PUBLIC_API_BASE_URL=https://api.hamzaammar.ca
```

### Verify Backend is Running

Test the backend directly:
```bash
curl http://localhost:3000/health
# Should return: {"ok":true}
```

### Check API URL in App

The app logs the API base URL in development mode. Check your console for:
```
[API] Base URL: http://localhost:3000
```

Make sure this matches where your backend is actually running.

### Backend Requirements

Your backend must:
1. Have `MCP_TRANSPORT=http` or `MCP_TRANSPORT=https` set
2. Be running on the port specified in `EXPO_PUBLIC_API_BASE_URL` (default: 3000)
3. Have CORS enabled (should be enabled by default in your Express setup)
4. Have the `/api/*` routes mounted (they should be via `authMiddleware`)

### Quick Test

1. Open your browser and go to: `http://localhost:3000/health`
   - Should return: `{"ok":true}`

2. If that works, the backend is running. The issue is likely:
   - Wrong API URL in the app
   - Network/firewall blocking the connection
   - CORS issue (check backend CORS config)
