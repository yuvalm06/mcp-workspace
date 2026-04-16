import { NextRequest } from 'next/server'
import { supabaseServer } from './supabaseServer'

export async function getUserFromRequest(req: NextRequest) {
  // Cookie-based auth (web app)
  let accessToken = req.cookies.get('sb-access-token')?.value

  // Bearer token auth (Chrome extension — reads cookie directly and sends as header)
  if (!accessToken) {
    const auth = req.headers.get('Authorization') ?? req.headers.get('authorization')
    if (auth?.startsWith('Bearer ')) accessToken = auth.slice(7)
  }

  if (!accessToken) return null
  try {
    const { data: { user }, error } = await supabaseServer().auth.getUser(accessToken)
    if (error || !user) return null
    return user
  } catch {
    return null
  }
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
