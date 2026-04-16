const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || 'http://localhost:3000/mcp'
const USER_ID = process.env.NEXT_PUBLIC_MCP_USER_ID || 'dev'

let sessionId: string | null = null

async function getSession(): Promise<string> {
  if (sessionId) return sessionId
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'quill-app', version: '1.0' } }, id: 1 }),
  })
  sessionId = res.headers.get('mcp-session-id')
  if (!sessionId) throw new Error('No session ID')
  return sessionId
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const sid = await getSession()
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sid,
      'x-user-id': USER_ID,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: Math.random() }),
  })
  const text = await res.text()
  const line = text.split('\n').find(l => l.startsWith('data:'))
  if (!line) throw new Error('No data')
  const json = JSON.parse(line.slice(5))
  if (json.error) throw new Error(json.error.message)
  const content = json.result?.content?.[0]?.text
  return JSON.parse(content)
}

export async function getCourses() {
  return callTool('get_my_courses') as Promise<Course[]>
}

export async function getGrades(orgUnitId: number) {
  return callTool('get_my_grades', { orgUnitId }) as Promise<Grade[]>
}

export async function getDeadlines(orgUnitId: number) {
  return callTool('get_upcoming_due_dates', { orgUnitId, daysBack: 0, daysAhead: 30 }) as Promise<CalendarEvent[]>
}

export async function getCourseContent(orgUnitId: number) {
  return callTool('get_course_content', { orgUnitId }) as Promise<Module[]>
}

export type Course = {
  id: number
  name: string
  code: string
  type: string
  isActive: boolean
  canAccess: boolean
  homeUrl?: string
  lastAccessed?: string
}

export type Grade = {
  name: string
  points: number | null
  maxPoints: number | null
  percentage: string | null
  feedback?: string
}

export type CalendarEvent = {
  title: string
  startDate: string
  endDate: string
  type: string
}

export type Module = {
  id: number
  title: string
  description?: string
  modules?: Module[]
  topics?: Topic[]
}

export type Topic = {
  id: number
  title: string
  url?: string
  type: string
}
