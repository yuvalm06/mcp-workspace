import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

// GET /api/threads/[id] — load thread + all messages
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  const sb = supabaseServer()

  const { data: thread, error: te } = await sb
    .from('threads')
    .select('id, title, course_id, course_code, course_name, created_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (te || !thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: messages, error: me } = await sb
    .from('messages')
    .select('id, role, content, blocks, sources, created_at')
    .eq('thread_id', id)
    .order('created_at', { ascending: true })

  if (me) return NextResponse.json({ error: me.message }, { status: 500 })

  return NextResponse.json({ thread, messages })
}

// POST /api/threads/[id] — append messages + bump updated_at
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  const { messages } = await req.json()

  const sb = supabaseServer()

  // Verify ownership
  const { data: thread } = await sb
    .from('threads')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = messages.map((m: any) => ({
    thread_id: id,
    role:      m.role,
    content:   m.content,
    blocks:    m.blocks ?? null,
    sources:   m.sources ?? null,
  }))

  const { error: me } = await sb.from('messages').insert(rows)
  if (me) return NextResponse.json({ error: me.message }, { status: 500 })

  await sb
    .from('threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
