#!/bin/bash
# debug-jwt.sh — get a Supabase token and test ECS JWT verification

SUPABASE_URL="https://qialmumlcezeqvyyhjlu.supabase.co"
SUPABASE_ANON_KEY="YOUR_ANON_KEY_HERE"  # from study-mcp-app/.env EXPO_PUBLIC_SUPABASE_ANON_KEY
EMAIL="YOUR_EMAIL_HERE"
PASSWORD="YOUR_PASSWORD_HERE"

echo "🔑 Getting Supabase token..."
RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo $RESPONSE | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token. Response:"
  echo $RESPONSE
  exit 1
fi

echo "✅ Got token (${#TOKEN} chars)"
echo ""
echo "🔍 Decoding JWT header/payload..."
curl -s -X POST https://horizon.hamzaammar.ca/debug/jwt \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo "🧪 Testing authenticated endpoint..."
curl -s https://horizon.hamzaammar.ca/api/d2l/status \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
