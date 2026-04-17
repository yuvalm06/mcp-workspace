import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { D2L_API, getD2LSession, d2lGet } from '@/lib/d2l'

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const courseId   = new URL(req.url).searchParams.get('courseId')
  const courseCode = new URL(req.url).searchParams.get('courseCode')
  const courseName = new URL(req.url).searchParams.get('courseName')
  if (!courseId) return NextResponse.json({ starters: [] })

  const d2l = await getD2LSession(user.id)
  if (!d2l) return NextResponse.json({ starters: [] })

  const orgUnitId = Number(courseId)

  // Fetch TOC, deadlines, and announcements in parallel
  const now   = new Date()
  const start = now.toISOString()
  const end   = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const calParams = new URLSearchParams({ startDateTime: start, endDateTime: end }).toString()

  const [tocRaw, calRaw, newsRaw] = await Promise.all([
    d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/content/toc`),
    d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/calendar/events/myEvents/?${calParams}`),
    d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/news/`),
  ])

  // Build a compact context string for the LLM
  let context = `Course: ${courseCode}${courseName ? ` — ${courseName}` : ''}\nToday: ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n`

  // Recent modules/topics from TOC (last ~6 modules worth of content)
  if (tocRaw?.Modules) {
    const modules: { title: string; topics: string[] }[] = []
    function walkModules(mods: any[]) {
      for (const m of mods) {
        const topics = (m.Topics || []).map((t: any) => t.Title).filter(Boolean)
        if (topics.length > 0 || m.Title) {
          modules.push({ title: m.Title || '', topics })
        }
        walkModules(m.Modules || [])
      }
    }
    walkModules(tocRaw.Modules)
    // Take the last 6 modules (most recent content)
    const recent = modules.slice(-6)
    if (recent.length > 0) {
      context += '\nRecent course modules:\n'
      for (const m of recent) {
        context += `- ${m.title}`
        if (m.topics.length > 0) context += `: ${m.topics.slice(0, 4).join(', ')}`
        context += '\n'
      }
    }
  }

  // Upcoming deadlines
  const calObjects: any[] = calRaw?.Objects || (Array.isArray(calRaw) ? calRaw : [])
  if (calObjects.length > 0) {
    const upcoming = calObjects
      .filter((e: any) => e.EndDateTime && new Date(e.EndDateTime) > now)
      .sort((a: any, b: any) => new Date(a.EndDateTime).getTime() - new Date(b.EndDateTime).getTime())
      .slice(0, 4)
    if (upcoming.length > 0) {
      context += '\nUpcoming deadlines:\n'
      for (const e of upcoming) {
        const date = new Date(e.EndDateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        context += `- ${e.Title} (due ${date})\n`
      }
    }
  }

  // Recent announcements (titles only)
  if (Array.isArray(newsRaw) && newsRaw.length > 0) {
    context += '\nRecent announcements:\n'
    for (const a of newsRaw.slice(0, 3)) {
      context += `- ${a.Title}\n`
    }
  }

  // Generate personalized starters via GPT-4o-mini
  const prompt = `You are helping generate 3 suggested prompts for a university student opening their AI study assistant for ${courseCode}. The prompts appear as clickable buttons — they must feel specific to THIS course, THIS week.

${context}

Rules:
- Each prompt must reference actual content: a specific module topic, a specific upcoming deadline, or a specific lecture concept.
- Prompts should cover different intents: one about understanding recent material, one about practice/preparation, one about logistics/deadlines.
- If there are upcoming deadlines, one prompt MUST reference the nearest one by name.
- Never use generic prompts like "summarize this course" or "help me study". Be specific.
- Each prompt must be under 55 characters.
- Use casual student voice: "explain the..." not "Could you explain the..."

Return a JSON array of 3 objects, each with "label" (2-3 word category, lowercase) and "text" (the prompt). No other text.

Example output:
[{"label":"recent lecture","text":"explain the Fourier transform from this week"},{"label":"prep","text":"quiz me before the midterm on Friday"},{"label":"deadlines","text":"what's due next in this course?"}]`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? '[]'
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return NextResponse.json({
        starters: parsed.slice(0, 3).map((s: any) => ({
          label: String(s.label || '').slice(0, 30),
          text:  String(s.text  || '').slice(0, 80),
        })),
      })
    }
  } catch (err) {
    console.error('[course-starters] generation failed:', err)
  }

  return NextResponse.json({ starters: [] })
}
