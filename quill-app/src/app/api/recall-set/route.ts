import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  D2L_API, getD2LSession, d2lGet, getPdfText,
  collectCoursePdfs, SOURCE_TYPE_PRIORITY,
} from '@/lib/d2l'

export const maxDuration = 60

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecallCard {
  id: string
  question: string
  answer: string
  topic: string
  sourceHint?: string
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { courseId, courseCode, courseName, weekNum } = await req.json()
  if (!courseId || !courseCode) {
    return NextResponse.json({ error: 'courseId and courseCode are required' }, { status: 400 })
  }

  // ── 1. D2L session ──────────────────────────────────────────────────────────
  const d2l = await getD2LSession(user.id)
  if (!d2l) {
    return NextResponse.json({ error: 'No D2L session — reconnect your account' }, { status: 401 })
  }

  // ── 2. Fetch TOC ────────────────────────────────────────────────────────────
  const tocRaw = await d2lGet(d2l, `/d2l/api/le/${D2L_API}/${Number(courseId)}/content/toc`)
  if (!tocRaw?.Modules) {
    return NextResponse.json({ error: 'Could not load course content' }, { status: 502 })
  }

  function marshalMod(m: any): any {
    return {
      title: m.Title,
      topics: (m.Topics || []).map((t: any) => ({ title: t.Title, url: t.Url || '' })),
      modules: (m.Modules || []).map(marshalMod),
    }
  }
  const modules = tocRaw.Modules.map(marshalMod)

  // ── 3. Collect PDFs — prioritise lectures; optionally filter by week ────────
  const allPdfs = collectCoursePdfs(modules)

  // If weekNum is provided, attempt to filter to that week's material
  let targetPdfs = allPdfs
  if (weekNum != null) {
    const weekFiltered = allPdfs.filter(pdf => {
      const t = `${pdf.title} ${pdf.parentTitle || ''}`.toLowerCase()
      return (
        t.includes(`week ${weekNum}`) ||
        t.includes(`week${weekNum}`) ||
        t.includes(`wk ${weekNum}`) ||
        t.includes(`wk${weekNum}`) ||
        t.includes(`lecture ${weekNum}`) ||
        t.includes(`lec ${weekNum}`) ||
        t.includes(`lec${weekNum}`) ||
        t.includes(`module ${weekNum}`) ||
        t.includes(`chapter ${weekNum}`)
      )
    })
    // Only apply the filter if it actually narrows things down
    if (weekFiltered.length >= 1) {
      targetPdfs = weekFiltered
    }
  }

  // Sort by priority (lectures first for recall, then tutorials/assignments)
  const sorted = [...targetPdfs].sort((a, b) => {
    const pa = SOURCE_TYPE_PRIORITY[a.sourceType]
    const pb = SOURCE_TYPE_PRIORITY[b.sourceType]
    return pa - pb
  })

  // ── 4. Load content — focused budget, parallel fetches ───────────────────────
  // Recall only needs a few recent lectures — keep it fast
  const MAX_FILES       = 4
  const BUDGET_PER_FILE = 8000
  const toLoad = sorted.slice(0, MAX_FILES)

  const pdfResults = await Promise.all(
    toLoad.map(async (pdf) => {
      const text = await getPdfText(d2l, pdf.url)
      return { pdf, text }
    })
  )

  let courseContent = ''
  const loadedFiles: string[] = []
  for (const { pdf, text } of pdfResults) {
    if (!text) continue
    const chunk = text.slice(0, BUDGET_PER_FILE)
    const label = `[${pdf.sourceType}${pdf.parentTitle ? ` — ${pdf.parentTitle}` : ''} / ${pdf.title}]`
    courseContent += `\n\n${label}:\n${chunk}`
    loadedFiles.push(`${pdf.sourceType}: ${pdf.title}`)
  }

  if (!courseContent.trim()) {
    return NextResponse.json(
      { error: 'No course content found. Make sure your OnQ connection is active and the course has materials.' },
      { status: 422 }
    )
  }

  // ── 5. Build prompt ─────────────────────────────────────────────────────────
  const weekContext = weekNum != null ? ` — Week ${weekNum}` : ''
  const systemPrompt = `You are creating active recall flashcards for a university student in ${courseCode}${courseName ? ` (${courseName})` : ''}${weekContext}.

Active recall is one of the most effective study techniques. Your cards must trigger genuine retrieval, not just recognition.

CARD QUALITY RULES:
- Each question should test a single, precise concept, definition, or mechanism
- Questions must be specific enough that there is one clear correct answer
- Avoid vague "what is" questions — prefer "explain", "how does", "why", "what happens when", "derive/state", "distinguish between"
- For math/science courses: include numerical or derivation questions with worked answers
- For theory courses: test relationships between concepts, not just isolated facts
- Card count: generate between 8 and 15 cards, calibrated to the density and breadth of content provided

SOURCE FIDELITY:
- Ground every card directly in the material provided — do not hallucinate content
- Use the exact terminology from the source material
- sourceHint should name the specific lecture, week, or section the card comes from

Return a raw JSON array only — no markdown fences, no preamble. Start with [ and end with ]:
[
  {
    "id": "c1",
    "topic": "exact topic name",
    "question": "Full question text. Use $...$ for inline math. Use $$...$$ for display equations.",
    "answer": "Complete, clear answer. For derivations, show key steps. Use $...$ for math. 2-5 sentences max.",
    "sourceHint": "Week 3 — Kinematics"
  }
]`

  // ── 6. Call Claude Haiku ────────────────────────────────────────────────────
  const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-3-5-haiku',
      max_tokens: 4000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate active recall flashcards from this course material:\n\n${courseContent}`,
        },
      ],
    }),
  })

  if (!aiRes.ok) {
    const errText = await aiRes.text()
    console.error('[recall-set] AI error:', aiRes.status, errText.slice(0, 400))
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  const aiData = await aiRes.json()
  const raw = (aiData.choices?.[0]?.message?.content || '').trim()

  // ── 7. Parse ────────────────────────────────────────────────────────────────
  let cards: RecallCard[]
  try {
    const start = raw.indexOf('[')
    const end   = raw.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No JSON array found')
    cards = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(cards) || cards.length === 0) throw new Error('Empty cards array')
  } catch (err: any) {
    console.error('[recall-set] parse error:', err?.message, '\nraw:', raw.slice(0, 400))
    return NextResponse.json({ error: 'Failed to parse generated cards' }, { status: 500 })
  }

  // ── 8. Save to Supabase ─────────────────────────────────────────────────────
  const sb = supabaseServer()
  const { data: session, error: insertError } = await sb
    .from('recall_sessions')
    .insert({
      user_id:     user.id,
      course_id:   String(courseId),
      course_code: courseCode,
      course_name: courseName || null,
      week_num:    weekNum ?? null,
      cards,
    })
    .select('id')
    .single()

  if (insertError || !session) {
    console.error('[recall-set] insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save session' }, { status: 500 })
  }

  return NextResponse.json({
    sessionId:  session.id,
    cards,
    courseCode,
    courseName: courseName || null,
    weekNum:    weekNum ?? null,
  })
}
