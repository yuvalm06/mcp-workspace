import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const sbHeaders = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates,return=minimal',
})

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || ''
  // Allow Chrome extension and localhost origins
  const allowed = origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost')
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { d2lSessionVal, d2lSecureSessionVal } = await req.json()

  if (!d2lSessionVal || !d2lSecureSessionVal) {
    return NextResponse.json(
      { error: 'Missing d2lSessionVal or d2lSecureSessionVal' },
      { status: 400, headers: corsHeaders(req) }
    )
  }

  const token = JSON.stringify({ d2lSessionVal, d2lSecureSessionVal })

  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_credentials?on_conflict=user_id,service`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({
      user_id: user.id,
      service: 'd2l',
      host: 'onq.queensu.ca',
      token,
      updated_at: new Date().toISOString(),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[sync-cookies] Supabase error:', res.status, err)
    return NextResponse.json({ error: err }, { status: 500, headers: corsHeaders(req) })
  }

  // If the user has no name set yet, fetch it from D2L and save it
  const hasName = !!(user.user_metadata?.full_name as string | undefined)?.trim()
  if (!hasName) {
    try {
      const MCP_URL = process.env.MCP_URL || 'http://localhost:3000/mcp'
      // Init MCP session
      const initRes = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'quill-app', version: '1.0' } }, id: 1 }),
      })
      const sessionId = initRes.headers.get('mcp-session-id')
      if (sessionId) {
        const profileRes = await fetch(MCP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId, 'x-user-id': user.id },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_my_profile', arguments: {} }, id: 2 }),
        })
        const text = await profileRes.text()
        const lines = text.split('\n').filter(l => l.startsWith('data:'))
        const candidates = lines.length > 0
          ? [...lines].reverse().map(l => { try { return JSON.parse(l.slice(5)) } catch { return null } }).filter(Boolean)
          : (() => { try { return [JSON.parse(text)] } catch { return [] } })()
        for (const json of candidates) {
          const raw = json.result?.content?.[0]?.text
          if (raw) {
            const profile = JSON.parse(raw)
            const fullName = profile.displayName || `${profile.firstName} ${profile.lastName}`.trim()
            if (fullName) {
              await supabaseServer().auth.admin.updateUserById(user.id, {
                user_metadata: { ...user.user_metadata, full_name: fullName },
              })
            }
            break
          }
        }
      }
    } catch {
      // Non-fatal — name sync is best-effort
    }
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders(req) })
}
