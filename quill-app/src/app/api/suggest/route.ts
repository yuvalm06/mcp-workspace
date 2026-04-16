import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { messages, courseCode } = await req.json()

  const context = courseCode ? `The student is studying ${courseCode}.` : 'The student is asking general academic questions.'

  const prompt = `You are helping a university student using an AI study assistant called Quill. ${context}

Here is the recent conversation:
${messages.slice(-6).map((m: { role: string; content: string }) =>
  `${m.role === 'user' ? 'Student' : 'Quill'}: ${m.content}`
).join('\n')}

Based on this conversation, generate exactly 3 short follow-up questions the student might want to ask next. Each should be specific, directly relevant to what was just discussed, and under 60 characters. Return only a JSON array of 3 strings, no other text.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? '[]'

  try {
    const suggestions = JSON.parse(text)
    if (Array.isArray(suggestions) && suggestions.length) {
      return NextResponse.json({ suggestions: suggestions.slice(0, 3) })
    }
  } catch {}

  return NextResponse.json({ suggestions: [] })
}
