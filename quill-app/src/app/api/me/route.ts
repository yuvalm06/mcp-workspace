import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

function deriveName(user: { user_metadata?: Record<string, unknown>; email?: string }) {
  const fullName = (user.user_metadata?.full_name as string | undefined)?.trim()
  const emailPrefix = user.email?.split('@')[0] ?? ''
  return fullName || (emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1))
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const name     = deriveName(user)
  const initials = name.charAt(0).toUpperCase()

  return NextResponse.json({ name, initials, email: user.email })
}

export async function PATCH(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const sb = supabaseServer()
  const { error } = await sb.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, full_name: name.trim() },
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
