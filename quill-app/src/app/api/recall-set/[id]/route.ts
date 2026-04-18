import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

// ── GET — load recall session ────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  const sb = supabaseServer()

  const { data, error } = await sb
    .from('recall_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

// ── PATCH — save results ─────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  const { results } = await req.json() as { results: Record<string, 'pass' | 'fail'> }

  if (!results || typeof results !== 'object') {
    return NextResponse.json({ error: 'results object is required' }, { status: 400 })
  }

  const sb = supabaseServer()

  // Load session to compute score
  const { data: session, error: fetchError } = await sb
    .from('recall_sessions')
    .select('cards')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const totalCards = (session.cards as any[]).length
  const score      = Object.values(results).filter(v => v === 'pass').length

  const { error: updateError } = await sb
    .from('recall_sessions')
    .update({
      results,
      score,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[recall-set] update error:', updateError)
    return NextResponse.json({ error: 'Failed to save results' }, { status: 500 })
  }

  return NextResponse.json({ score, totalCards })
}
