import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const MCP_URL = process.env.MCP_URL || 'http://localhost:3000/mcp'
  const USER_ID = user.id

  const initRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'quill-app', version: '1.0' } }, id: 1 }),
  })
  const sessionId = initRes.headers.get('mcp-session-id')
  if (!sessionId) return NextResponse.json({ error: 'No session' }, { status: 500 })

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId, 'x-user-id': USER_ID },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_my_courses', arguments: {} }, id: 2 }),
  })
  const text = await res.text()
  const lines = text.split('\n').filter((l: string) => l.startsWith('data:'))
  const candidates = lines.length > 0
    ? [...lines].reverse().map(l => { try { return JSON.parse(l.slice(5)) } catch { return null } }).filter(Boolean)
    : (() => { try { return [JSON.parse(text)] } catch { return [] } })()
  const json = candidates.find((c: any) => c.result?.content?.[0]?.text)
  if (!json) return NextResponse.json({ error: 'No data' }, { status: 500 })
  const courses = JSON.parse(json.result.content[0].text)

  // Keep W26 current courses + no-semester staples, exclude F25/F24/W25 old ones
  const current = courses.filter((c: any) => {
    const code = (c.code || '').toUpperCase()
    const name = (c.name || '').toUpperCase()
    if (code.includes('W26') || name.includes('W26')) return true
    if (code.includes('F25') || code.includes('F24') || code.includes('W25') || code.includes('S25')) return false
    if (!c.canAccess) return false
    return true // no-semester courses like EngQ Hub
  })

  return NextResponse.json(current)
}
