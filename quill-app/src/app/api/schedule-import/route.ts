import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const maxDuration = 60

export type ParsedCourse = {
  courseCode: string
  title: string
  type: 'lecture' | 'tutorial' | 'lab' | 'studio' | 'other'
  days: number[]        // 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
  startTime: string     // "HH:MM" 24h
  endTime: string       // "HH:MM" 24h
  biweekly: boolean
  notes: string
}

const SYSTEM_PROMPT = `Read the university schedule screenshot and return a JSON array of every class session. Each object: courseCode (e.g. "MECH 241"), title (same as courseCode), type ("lecture","tutorial","lab","studio","other"), days (array of day indexes Mon=0 Tue=1 Wed=2 Thu=3 Fri=4 Sat=5 Sun=6), startTime (24h "HH:MM"), endTime (24h "HH:MM"), biweekly (false), notes (""). Return only the JSON array.`

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const body = await req.json()
  const { image, notes } = body as { image: string; notes?: string }

  if (!image) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

  const userContent: any[] = [
    { type: 'image_url', image_url: { url: image } },
    { type: 'text', text: 'This is my university SOLUS schedule. The columns left to right are: time, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday.' + (notes?.trim() ? ` Notes: ${notes.trim()}` : '') },
  ]

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[schedule-import] OpenRouter error:', err.slice(0, 500))
    return NextResponse.json({ error: 'Failed to parse image', detail: err.slice(0, 500) }, { status: 502 })
  }

  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content ?? ''

  try {
    // Strip any accidental markdown wrapping
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed: ParsedCourse[] = JSON.parse(clean)
    if (!Array.isArray(parsed)) throw new Error('Not an array')

    // Deduplicate by courseCode+type+startTime+endTime, merging days arrays
    const map = new Map<string, ParsedCourse>()
    for (const c of parsed) {
      c.biweekly = false
      c.courseCode = c.courseCode.replace(/\s*-\s*\d+$/, '').trim()  // strip section: "MECH 210 - 001" → "MECH 210"
      c.title = c.courseCode
      const key = `${c.courseCode}|${c.type}|${c.startTime}|${c.endTime}`
      if (map.has(key)) {
        const existing = map.get(key)!
        existing.days = [...new Set([...existing.days, ...c.days])].sort((a, b) => a - b)
      } else {
        map.set(key, { ...c, days: [...new Set(c.days)].sort((a, b) => a - b) })
      }
    }
    const courses = Array.from(map.values())

    return NextResponse.json({ courses })
  } catch {
    console.error('[schedule-import] Parse error. Raw:', raw.slice(0, 500))
    return NextResponse.json({ error: 'Could not parse schedule from image', raw }, { status: 422 })
  }
}
