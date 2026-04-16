import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { orgUnitId, modules } = await req.json()

  // Find lecture PDFs from content
  const lectureFiles: string[] = []
  for (const mod of modules || []) {
    for (const submod of mod.modules || []) {
      if (submod.title === 'Lecture') {
        for (const topic of submod.topics || []) {
          if (topic.url?.endsWith('.pdf') && !topic.title.includes('filled')) {
            lectureFiles.push(topic.url)
          }
        }
      }
    }
  }

  if (lectureFiles.length === 0) {
    return NextResponse.json({ exam: 'No lecture PDFs found in this course content.' })
  }

  const MCP_URL = process.env.MCP_URL || 'http://localhost:3000/mcp'

  const initRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'quill-app', version: '1.0' } }, id: 1 }),
  })
  const sessionId = initRes.headers.get('mcp-session-id')
  if (!sessionId) return NextResponse.json({ error: 'No session' }, { status: 500 })

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sessionId, 'x-user-id': user.id },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: Math.random() }),
    })
    const text = await res.text()
    const line = text.split('\n').find(l => l.startsWith('data:'))
    if (!line) return null
    const json = JSON.parse(line.slice(5))
    return json.result?.content?.[0]?.text
  }

  let allContent = ''
  for (const fileUrl of lectureFiles.slice(0, 2)) {
    await call('download_file', { url: fileUrl })
    const filename = fileUrl.split('/').pop() || 'file.pdf'
    const content = await call('read_file', { filePath: filename })
    if (content) {
      const start = content.indexOf('--- File Content ---')
      if (start !== -1) allContent += '\n\n' + content.slice(start + 20).slice(0, 4000)
    }
  }

  if (!allContent) return NextResponse.json({ exam: 'Could not read lecture content.' })

  const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are Quill, an AI academic assistant. Based on these lecture notes, create a practice exam with 3 multiple choice questions, 2 short answer questions, and 1 problem. Be specific to the content.\n\nLECTURE CONTENT:\n${allContent}`,
      }],
    }),
  })
  const aiData = await aiRes.json()
  const exam = aiData.choices?.[0]?.message?.content || 'Failed to generate exam.'

  return NextResponse.json({ exam })
}
