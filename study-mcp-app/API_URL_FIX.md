# Fix API URL Configuration

## The Issue

Your backend IS running at `https://api.hamzaammar.ca` (verified with curl), but the app might be:
1. Using `http://` instead of `https://`
2. Using `localhost:3000` in dev mode
3. Missing the environment variable

## Solution

### Option 1: Set Environment Variable (Recommended)

Create or update `.env` file in `study-mcp-app/`:

```env
EXPO_PUBLIC_API_BASE_URL=https://api.hamzaammar.ca
```

Then **restart Expo**:
```bash
# Stop current server (Ctrl+C)
npm start
```

### Option 2: Check Current Configuration

The app now logs the API URL on startup. Check your console for:
```
[API] Base URL: https://api.hamzaammar.ca
[API] __DEV__: true/false
[API] EXPO_PUBLIC_API_BASE_URL: ...
```

If it shows `http://localhost:3000` but you want to use production, set the env var.

### Option 3: Force Production URL

If you always want to use production (even in dev), you can temporarily modify `src/config/api.ts`:

```typescript
const API_BASE_URL = 'https://api.hamzaammar.ca';
```

But using the environment variable is better.

## Verify It's Working

After setting the env var and restarting:
1. Check console logs for the correct API URL
2. Try loading the dashboard
3. The 502 error should be gone

## Note

The backend is confirmed running at `https://api.hamzaammar.ca` - the `/health` endpoint returns `{"ok":true}`. The issue is just the app's configuration.
