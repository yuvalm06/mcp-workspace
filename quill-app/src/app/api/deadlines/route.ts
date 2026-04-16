import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

// W26 course IDs with their codes for mapping
const W26_COURSES = [
  { id: 1109841, code: 'MECH 241' },
  { id: 1110300, code: 'MECH 210' },
  { id: 1111819, code: 'MECH 228' },
  { id: 1112937, code: 'MECH 203' },
  { id: 1123309, code: 'APSC 200' },
  { id: 1124097, code: 'MECH 273' },
]

async function mcpCall(sessionId: string, userId: string, toolName: string, args: Record<string, unknown>) {
  const MCP_URL = process.env.MCP_URL || 'http://localhost:3000/mcp'
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId, 'x-user-id': userId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: toolName, arguments: args }, id: Math.random() }),
  })
  const text = await res.text()
  const line = text.split('\n').find(l => l.startsWith('data:'))
  if (!line) return null
  const json = JSON.parse(line.slice(5))
  const content = json.result?.content?.[0]?.text
  if (!content) return null
  try { return JSON.parse(content) } catch { return null }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const MCP_URL = process.env.MCP_URL || 'http://localhost:3000/mcp'

  const initRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'quill-app', version: '1.0' } }, id: 1 }),
  })
  const sessionId = initRes.headers.get('mcp-session-id')
  if (!sessionId) return NextResponse.json({ error: 'No session' }, { status: 500 })

  const daysAhead = Number(new URL(req.url).searchParams.get('daysAhead') || 60)

  const results = await Promise.allSettled(
    W26_COURSES.map(async (course) => {
      const events = await mcpCall(sessionId, user.id, 'get_upcoming_due_dates', { orgUnitId: course.id, daysBack: 0, daysAhead })
      return { courseId: course.id, courseCode: course.code, events: events || [] }
    })
  )

  const allDeadlines: any[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const event of result.value.events) {
        allDeadlines.push({ ...event, courseId: result.value.courseId, courseCode: result.value.courseCode })
      }
    }
  }

  allDeadlines.sort((a, b) => new Date(a.dueDateIso || 0).getTime() - new Date(b.dueDateIso || 0).getTime())

  return NextResponse.json(allDeadlines)
}
