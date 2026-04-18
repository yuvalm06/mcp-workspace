import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || ''
  const allowed = origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost')
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('sb-refresh-token')?.value
  const cors = corsHeaders(req)

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401, headers: cors })
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  const data = await res.json()

  if (!res.ok) {
    const response = NextResponse.json({ error: 'Session expired' }, { status: 401, headers: cors })
    response.cookies.set('sb-access-token', '', { maxAge: 0, path: '/' })
    response.cookies.set('sb-refresh-token', '', { maxAge: 0, path: '/' })
    return response
  }

  const response = NextResponse.json({ ok: true }, { headers: cors })
  response.cookies.set('sb-access-token', data.access_token, {
    ...SESSION_COOKIE_OPTS,
    maxAge: data.expires_in ?? 3600,
  })
  response.cookies.set('sb-refresh-token', data.refresh_token, {
    ...SESSION_COOKIE_OPTS,
    maxAge: 60 * 60 * 24 * 7,
  })
  return response
}
