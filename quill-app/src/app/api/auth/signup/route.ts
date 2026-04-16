import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  // Create the account
  const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: { full_name: name?.trim() || '' } }),
  })

  const signupData = await signupRes.json()

  if (!signupRes.ok) {
    return NextResponse.json(
      { error: signupData.error_description || signupData.msg || 'Could not create account' },
      { status: 400 }
    )
  }

  // If email confirmation is disabled, Supabase returns a session immediately.
  // If confirmation is required, access_token will be absent — tell the user to check email.
  if (!signupData.access_token) {
    return NextResponse.json({ confirm: true })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('sb-access-token', signupData.access_token, {
    ...SESSION_COOKIE_OPTS,
    maxAge: signupData.expires_in ?? 3600,
  })
  response.cookies.set('sb-refresh-token', signupData.refresh_token, {
    ...SESSION_COOKIE_OPTS,
    maxAge: 60 * 60 * 24 * 7,
  })
  return response
}
