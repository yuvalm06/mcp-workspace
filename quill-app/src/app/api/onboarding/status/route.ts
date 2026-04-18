import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const sbHeaders = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
})

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const [credsRes, examsRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/user_credentials?user_id=eq.${user.id}&service=eq.d2l&select=id`,
      { headers: sbHeaders() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/exams?user_id=eq.${user.id}&select=id&limit=1`,
      { headers: sbHeaders() },
    ),
  ])

  const creds = await credsRes.json()
  const exams = await examsRes.json()

  return NextResponse.json({
    connected: Array.isArray(creds) && creds.length > 0,
    hasExams: Array.isArray(exams) && exams.length > 0,
  })
}
