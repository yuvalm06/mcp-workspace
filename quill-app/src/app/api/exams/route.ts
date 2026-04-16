import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const sbHeaders = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
})

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/exams?user_id=eq.${user.id}&order=exam_date.asc&exam_date=gte.${new Date().toISOString()}`,
    { headers: sbHeaders() }
  )
  const data = await res.json()
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const body = await req.json()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/exams`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify({ ...body, user_id: user.id }),
  })
  const data = await res.json()
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await req.json()
  await fetch(`${SUPABASE_URL}/rest/v1/exams?id=eq.${id}&user_id=eq.${user.id}`, {
    method: 'DELETE',
    headers: sbHeaders(),
  })
  return NextResponse.json({ ok: true })
}
