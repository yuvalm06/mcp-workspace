import { NextRequest } from 'next/server'
import { supabaseServer } from './supabaseServer'

export async function getUserFromRequest(req: NextRequest) {
  const accessToken = req.cookies.get('sb-access-token')?.value
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
