import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  try {
    const sb = supabaseServer()
    const { data, error } = await sb
      .from('calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: true })
    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  try {
    const body = await req.json()
    const sb = supabaseServer()
    const { data, error } = await sb
      .from('calendar_events')
      .insert({
        user_id:    user.id,
        title:      body.title,
        code:       body.code ?? null,
        color_idx:  body.colorIdx ?? 0,
        date:       body.date,
        start_time: body.startTime,
        end_time:   body.endTime,
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
