import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

// GET /api/threads — list threads for logged-in user, newest first
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const sb = supabaseServer()
  const { data, error } = await sb
    .from('threads')
    .select('id, title, course_id, course_code, course_name, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/threads — create a new thread with its first pair of messages
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { courseId, courseCode, courseName, messages } = await req.json()
  // Derive title from first user message
  const firstUser = messages?.find((m: any) => m.role === 'user')
  const title = firstUser
    ? firstUser.content.slice(0, 80).trim()
    : 'New conversation'

  const sb = supabaseServer()

  const { data: thread, error: te } = await sb
    .from('threads')
    .insert({
      user_id:     user.id,
      course_id:   courseId ?? null,
      course_code: courseCode ?? null,
      course_name: courseName ?? null,
      title,
    })
    .select('id')
    .single()

  if (te || !thread) return NextResponse.json({ error: te?.message ?? 'insert failed' }, { status: 500 })

  if (messages?.length) {
    const rows = messages.map((m: any) => ({
      thread_id: thread.id,
      role:      m.role,
      content:   m.content,
      blocks:    m.blocks ?? null,
      sources:   m.sources ?? null,
    }))
    const { error: me } = await sb.from('messages').insert(rows)
    if (me) console.error('[threads] message insert error:', me.message)
  }

  return NextResponse.json({ id: thread.id })
}
