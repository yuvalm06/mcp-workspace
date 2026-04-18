import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup']

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

// Read JWT exp claim without verifying signature — fast, no network call
function tokenIsValid(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return typeof payload.exp === 'number' && payload.exp > Date.now() / 1000
  } catch {
    return false
  }
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const accessToken = request.cookies.get('sb-access-token')?.value
  const refreshToken = request.cookies.get('sb-refresh-token')?.value
  const isAuthed = !!accessToken && tokenIsValid(accessToken)

  // Redirect authenticated users away from login/signup
  if (isAuthed && isPublic(pathname)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Public pages don't need auth
  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  // Valid token → pass through
  if (isAuthed) {
    return NextResponse.next()
  }

  // Access token expired but refresh token exists → try silent refresh
  if (refreshToken) {
    try {
      const res = await fetch(
        `${process.env.SUPABASE_URL!}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
      )
      if (res.ok) {
        const data = await res.json()
        const response = NextResponse.next()
        response.cookies.set('sb-access-token', data.access_token, {
          ...COOKIE_OPTS,
          maxAge: data.expires_in ?? 3600,
        })
        response.cookies.set('sb-refresh-token', data.refresh_token, {
          ...COOKIE_OPTS,
          maxAge: 60 * 60 * 24 * 7,
        })
        return response
      }
    } catch {
      // refresh failed — fall through to redirect
    }
  }

  // No valid session → login
  return NextResponse.redirect(new URL('/login', request.url))
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
