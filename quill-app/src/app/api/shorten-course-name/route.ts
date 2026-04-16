import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const names: string[] = Array.isArray(body.names) ? body.names : []

  if (names.length === 0) {
    return NextResponse.json({ shorts: {} })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    // Graceful degradation: return names unchanged
    return NextResponse.json({ shorts: Object.fromEntries(names.map(n => [n, n])) })
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You shorten university course names into the natural abbreviations students actually say out loud.
Rules:
- If the name is already ≤ 20 characters, return it exactly unchanged.
- Otherwise abbreviate to ≤ 20 characters using real student shorthand (e.g. "Thermo", "Fluid Mech.", "Eng. Design").
- Never use acronyms unless universally recognized.
- Return a JSON object with a single key "shorts" whose value maps each input name to its shortened form.
- Return ONLY valid JSON, no explanation, no markdown.`,
          },
          {
            role: 'user',
            content: JSON.stringify(names),
          },
        ],
      }),
    })

    if (!res.ok) throw new Error(`OpenAI ${res.status}`)

    const data = await res.json()
    const content: string = data.choices?.[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(content)
    const shorts: Record<string, string> = parsed.shorts ?? parsed

    // Validate: every input name should have an entry; fall back to original if missing
    const safe: Record<string, string> = {}
    for (const name of names) {
      safe[name] = typeof shorts[name] === 'string' && shorts[name].trim()
        ? shorts[name].trim()
        : name
    }

    return NextResponse.json({ shorts: safe })
  } catch {
    // Any error → return originals so UI never breaks
    return NextResponse.json({ shorts: Object.fromEntries(names.map(n => [n, n])) })
  }
}
