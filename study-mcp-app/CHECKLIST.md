# Setup Checklist - What You Have vs What You Need

## ✅ What's Already Set Up

### Backend (AWS ECS)
- ✅ Backend deployed on ECS Fargate
- ✅ Database connectivity fixed (security group rule added)
- ✅ API endpoints implemented:
  - `/api/dashboard` - Dashboard stats
  - `/api/notes` - List notes
  - `/api/notes/presign-upload` - Get S3 upload URL
  - `/api/notes/process` - Process uploaded PDF
  - `/api/notes/embed-missing` - Generate embeddings
  - `/api/search` - Search notes
  - `/api/d2l/status`, `/api/d2l/sync`, `/api/d2l/courses` - D2L integration
  - `/api/piazza/status`, `/api/piazza/sync`, `/api/piazza/search` - Piazza integration
- ✅ Authentication middleware (JWT from Cognito)
- ✅ Database (RDS PostgreSQL with pgvector)

### Mobile App
- ✅ Expo app structure
- ✅ Navigation (Auth flow + Main tabs)
- ✅ Cognito authentication (login, signup, email verification)
- ✅ Environment variables configured (`.env` file exists)
- ✅ API client with auth token injection
- ✅ All screens implemented (Dashboard, Notes, Search, Upload, Settings)

## 🔍 What You Might Be Missing

### 1. **Test the App Flow**

Try this complete flow:

1. **Sign Up / Login**
   - Open the app
   - Sign up with a new account (or login if you have one)
   - Verify email if required
   - You should see the Dashboard

2. **Upload a Note**
   - Go to Notes tab → Tap "Upload" button
   - Select a PDF file
   - Wait for upload and processing
   - Check Notes tab to see your note

3. **Search**
   - Go to Search tab
   - Type a query
   - Should see results from your notes

4. **Dashboard**
   - Should show note count, recent notes, etc.

### 2. **Common Issues to Check**

#### If Dashboard shows errors:
- ✅ Database connection is fixed (we just did this)
- Check if you have any notes uploaded yet
- Check backend logs: `aws logs tail /ecs/study-mcp-backend --follow`

#### If Upload fails:
- Check if S3 is configured in backend
- Check if `S3_BUCKET` is set in AWS Secrets Manager
- Check if IAM role has S3 permissions

#### If Search returns no results:
- Upload a note first
- Wait for processing to complete
- Try "Embed Missing Notes" in Settings

#### If D2L/Piazza don't work:
- These require backend credentials (D2L_USERNAME, D2L_PASSWORD, etc.)
- Check Settings screen for connection status
- Sync from Settings screen

### 3. **Backend Environment Variables**

Check these are set in AWS Secrets Manager:
- ✅ `SUPABASE_URL` - Database connection (set)
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Database key (set)
- ✅ `COGNITO_USER_POOL_ID` - Auth (set)
- ✅ `COGNITO_CLIENT_ID` - Auth (set)
- ✅ `OPENAI_API_KEY` - For embeddings (check if set)
- ✅ `S3_BUCKET` - For file uploads (check if set)
- ✅ `AWS_REGION` - AWS region (set)
- ✅ `D2L_HOST`, `D2L_USERNAME`, `D2L_PASSWORD` - D2L integration (check if set)

### 4. **Mobile App Environment Variables**

Your `.env` file has:
- ✅ `EXPO_PUBLIC_COGNITO_USER_POOL_ID`
- ✅ `EXPO_PUBLIC_COGNITO_CLIENT_ID`
- ✅ `EXPO_PUBLIC_COGNITO_CLIENT_SECRET`
- ✅ `EXPO_PUBLIC_COGNITO_REGION`
- ✅ `EXPO_PUBLIC_API_BASE_URL`

**Important:** After changing `.env`, restart Expo:
```bash
# Stop Expo (Ctrl+C)
# Then restart:
npx expo start --clear
```

### 5. **What to Test Right Now**

1. **Backend Health:**
   ```bash
   curl https://api.hamzaammar.ca/health
   # Should return: {"ok":true}
   ```

2. **Backend Logs:**
   ```bash
   aws logs tail /ecs/study-mcp-backend --follow --region us-east-1
   ```

3. **Mobile App:**
   - Open app
   - Login/Signup
   - Try uploading a PDF
   - Check if it appears in Notes

## 🚨 If Something's Not Working

### Check Backend Logs First
```bash
aws logs tail /ecs/study-mcp-backend --since 10m --region us-east-1
```

### Common Error Patterns:

1. **"Database connection failed"**
   - ✅ Fixed! (we just added security group rule)

2. **"S3 not configured"**
   - Set `S3_BUCKET` in Secrets Manager
   - Check IAM role has S3 permissions

3. **"Invalid or expired token"**
   - Re-login in the app
   - Check Cognito configuration

4. **"No results found"**
   - Upload notes first
   - Wait for processing
   - Run "Embed Missing Notes" in Settings

5. **504 Gateway Timeout**
   - ✅ Should be fixed now (database connectivity)
   - If still happening, check ECS task status

## 📝 Next Steps

1. **Test the complete flow:**
   - Sign up → Upload PDF → Search → View Dashboard

2. **If upload works but search doesn't:**
   - Go to Settings → "Embed Missing Notes"
   - Wait for embeddings to generate
   - Try search again

3. **If D2L/Piazza integration needed:**
   - Set credentials in AWS Secrets Manager
   - Go to Settings → Connect D2L/Piazza
   - Sync data

4. **Monitor backend:**
   - Watch logs during testing
   - Check for any new errors

## 🎯 Quick Test Commands

```bash
# Test backend health
curl https://api.hamzaammar.ca/health

# Test dashboard (needs auth token)
# Get token from app logs or Cognito

# Check ECS service
aws ecs describe-services \
  --cluster study-mcp-cluster \
  --services study-mcp-backend \
  --region us-east-1 \
  --query 'services[0].{Running:runningCount,Desired:desiredCount}'

# View recent logs
aws logs tail /ecs/study-mcp-backend --since 5m --region us-east-1
```

---

**What specific error or issue are you seeing?** Share the error message or what's not working, and I can help debug it!
