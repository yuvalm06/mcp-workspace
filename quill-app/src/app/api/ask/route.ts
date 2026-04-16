import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

// ── Types ────────────────────────────────────────────────────────────────────

export type SourceType = 'LECTURE' | 'PAST EXAM' | 'TUTORIAL' | 'ASSIGNMENT' | 'FORMULA SHEET' | 'LAB' | 'OTHER'

export type Block =
  | { type: 'summary';   text: string }
  | { type: 'bullets';   items: string[] }
  | { type: 'highlight'; text: string }
  | { type: 'steps';     label?: string; items: string[] }
  | { type: 'question';  number?: number; text: string; cite?: string; solution?: string[]; origin?: 'real' | 'synthesized' }
  | { type: 'choice';    items: string[] }

export interface Source {
  filename: string
  url: string
  sourceType: SourceType
  title: string
}

// ── D2L direct client ─────────────────────────────────────────────────────────

interface D2LSession { cookieHeader: string; host: string }

const D2L_API = '1.57'

async function getD2LSession(userId: string): Promise<D2LSession | null> {
  const { data, error } = await supabaseServer()
    .from('user_credentials')
    .select('token, host')
    .eq('user_id', userId)
    .eq('service', 'd2l')
    .single()
  if (error || !data) return null
  try {
    const { d2lSessionVal, d2lSecureSessionVal } = JSON.parse(data.token as string)
    if (!d2lSessionVal || !d2lSecureSessionVal) return null
    return {
      cookieHeader: `d2lSessionVal=${d2lSessionVal}; d2lSecureSessionVal=${d2lSecureSessionVal}`,
      host: (data.host as string) || 'onq.queensu.ca',
    }
  } catch { return null }
}

async function d2lGet(session: D2LSession, path: string): Promise<any> {
  const url = `https://${session.host}${path}`
  const res = await fetch(url, { headers: { Cookie: session.cookieHeader } })
  if (!res.ok) {
    console.error('[d2l]', path, res.status)
    return null
  }
  return res.json()
}

// ── PDF cache + download ──────────────────────────────────────────────────────

interface PdfResult { cacheHit: boolean; chars: number; error?: string }

async function getPdfText(
  session: D2LSession,
  url: string,
  debugOut?: PdfResult
): Promise<string | null> {
  const sb = supabaseServer()

  // 1. Cache hit
  const { data } = await sb.from('pdf_cache').select('text').eq('url', url).single()
  if (data?.text) {
    if (debugOut) { debugOut.cacheHit = true; debugOut.chars = data.text.length }
    return data.text
  }

  // 2. Download with D2L session cookies
  const fullUrl = url.startsWith('http') ? url : `https://${session.host}${url}`
  let res: Response
  try {
    res = await fetch(fullUrl, { headers: { Cookie: session.cookieHeader }, redirect: 'follow' })
  } catch (err: any) {
    const msg = `fetch failed: ${err?.message}`
    console.error('[pdf]', msg)
    if (debugOut) debugOut.error = msg
    return null
  }
  if (!res.ok) {
    const msg = `HTTP ${res.status}`
    console.error('[pdf] download error', msg, fullUrl)
    if (debugOut) debugOut.error = msg
    return null
  }
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    const msg = 'got HTML — session expired?'
    console.error('[pdf]', msg)
    if (debugOut) debugOut.error = msg
    return null
  }

  // 3. Extract content via Gemini Flash vision (via OpenRouter)
  //    Handles typed slides AND handwritten notes — no image conversion needed
  let text: string | null = null
  try {
    const buf = Buffer.from(await res.arrayBuffer())
    const base64 = buf.toString('base64')

    const visionRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:application/pdf;base64,${base64}` },
            },
            {
              type: 'text',
              text: 'Extract all content from this document. Include all text, equations, diagrams described in words, and any handwritten notes. Be thorough and preserve structure.',
            },
          ],
        }],
      }),
    })

    const visionData = await visionRes.json()
    text = visionData.choices?.[0]?.message?.content?.trim() || null
    if (!visionRes.ok) throw new Error(visionData.error?.message || `HTTP ${visionRes.status}`)
  } catch (err: any) {
    const msg = `vision error: ${err?.message}`
    console.error('[pdf]', msg)
    if (debugOut) debugOut.error = msg
    return null
  }
  if (!text) {
    if (debugOut) debugOut.error = 'empty text after parse'
    return null
  }

  if (debugOut) { debugOut.cacheHit = false; debugOut.chars = text.length }

  // 4. Cache for next time (fire-and-forget)
  sb.from('pdf_cache').upsert({ url, text }).then(() => {})

  return text
}

// ── Source type detection ────────────────────────────────────────────────────

function detectSourceType(title: string, parentTitle: string): SourceType {
  const t = (title + ' ' + parentTitle).toLowerCase()
  if (/midterm|past[\s_-]?test|past[\s_-]?exam|previous[\s_-]?exam|sample[\s_-]?exam/.test(t)) return 'PAST EXAM'
  if (/formula|reference[\s_-]?sheet|cheat[\s_-]?sheet|equation[\s_-]?sheet/.test(t)) return 'FORMULA SHEET'
  if (/\btut(orial)?\b/.test(t)) return 'TUTORIAL'
  if (/\bassignment\b|\bhomework\b/.test(t)) return 'ASSIGNMENT'
  if (/\blab\b/.test(t)) return 'LAB'
  if (/lecture|slides|notes|week/.test(t)) return 'LECTURE'
  return 'OTHER'
}

const SOURCE_TYPE_PRIORITY: Record<SourceType, number> = {
  'PAST EXAM':     0,
  'FORMULA SHEET': 1,
  'LECTURE':       2,
  'TUTORIAL':      3,
  'ASSIGNMENT':    4,
  'LAB':           5,
  'OTHER':         6,
}

interface PdfCandidate { url: string; title: string; parentTitle: string; sourceType: SourceType; index: number }

// Find syllabus PDF URL in the content tree (first match)
function findSyllabus(modules: any[]): string | null {
  for (const mod of modules) {
    for (const topic of mod.topics || []) {
      const url: string   = topic.url || ''
      const title: string = (topic.title || '').toLowerCase()
      if (url.endsWith('.pdf') && title.includes('syllabus')) return url
    }
    const found = findSyllabus(mod.modules || [])
    if (found) return found
  }
  return null
}

// Walk content tree and collect all relevant PDFs (excluding solutions/answers/syllabus)
function collectCoursePdfs(modules: any[]): PdfCandidate[] {
  const pdfs: PdfCandidate[] = []
  let idx = 0
  function walk(mods: any[]) {
    for (const mod of mods) {
      for (const topic of mod.topics || []) {
        const url: string  = topic.url || ''
        const title: string = topic.title || ''
        const parentTitle: string = mod.title || ''
        if (!url.endsWith('.pdf')) continue
        const tl = title.toLowerCase()
        if (tl.includes('syllabus') || tl.includes('solution') || tl.includes('answer key')) continue
        pdfs.push({ url, title, parentTitle, sourceType: detectSourceType(title, parentTitle), index: idx++ })
      }
      walk(mod.modules || [])
    }
  }
  walk(modules)
  return pdfs
}

// Extract a week number — works on both natural language ("week 9") and filenames ("Week4_notes")
function extractWeekNumber(s: string): number | null {
  const m = s.toLowerCase().match(/(?:week|wk)[_\s-]?(\d{1,2})/)
  return m ? parseInt(m[1], 10) : null
}

// Extract a lecture number — works on both "lecture 10" and filenames like "10_Lecture10_MECH241"
function extractLectureNumber(s: string): number | null {
  const m = s.toLowerCase().match(/(?:lecture|lec|lect)[_\s-]?(\d{1,2})/)
  return m ? parseInt(m[1], 10) : null
}

// Score a candidate against a query: higher = more relevant
function scoreCandidate(c: PdfCandidate, queryWeek: number | null, queryLecture: number | null, queryLower: string): number {
  let score = 0
  // Include parentTitle (the OnQ folder/module name, e.g. "Week 4: CV Analysis...") in all matching
  const t = (c.title + ' ' + c.parentTitle + ' ' + c.url).toLowerCase()

  // Exact week match: strong boost
  if (queryWeek !== null) {
    const candWeek = extractWeekNumber(t)
    if (candWeek === queryWeek) score += 100
    else if (candWeek !== null && Math.abs(candWeek - queryWeek) === 1) score += 20
  }

  // Exact lecture number match: strong boost (overrides recency)
  if (queryLecture !== null) {
    const candLecture = extractLectureNumber(t)
    if (candLecture === queryLecture) score += 150
    // Fallback: number appears right after "lecture" keyword anywhere in title/url
    // Use extractLectureNumber result only — avoids false matches on "Week 10" for lecture 10
  }

  // Keyword overlap — keep words ≥ 2 chars so numbers like "10" aren't dropped
  const queryWords = queryLower.split(/\W+/).filter(w => w.length >= 2)
  for (const word of queryWords) {
    if (t.includes(word)) score += 10
  }

  // Penalize "course review" / "review" lectures as primary sources
  if (/\bcourse[\s_-]?review\b|\bfinal[\s_-]?review\b|\bexam[\s_-]?review\b/.test(t)) score -= 40

  // Recency bonus: small tiebreaker only — explicit matches dominate
  score += c.index * 0.3

  return score
}

// Select sources — two modes:
//   1. Explicit reference ("lecture 10", "week 4"): find those files directly, no scoring
//   2. Vague query ("recent stuff", "this week"): score by relevance
function selectSources(candidates: PdfCandidate[], maxCount = 3, query = ''): PdfCandidate[] {
  const queryLower   = query.toLowerCase()
  const queryWeek    = extractWeekNumber(queryLower)
  const queryLecture = extractLectureNumber(queryLower)

  const isOverviewQuery = /this week|last week|week \d|summarize|what('s| was) covered|overview of|go over/.test(queryLower)
  const effectiveMax    = isOverviewQuery ? Math.max(maxCount, 5) : maxCount

  const seen     = new Set<string>()
  const selected: PdfCandidate[] = []
  const add = (c: PdfCandidate) => {
    if (!seen.has(c.url) && selected.length < effectiveMax) { selected.push(c); seen.add(c.url) }
  }

  // ── Mode 1: explicit lecture/week reference → direct match, skip scoring ──
  const hasExplicitRef = queryLecture !== null || queryWeek !== null
  if (hasExplicitRef) {
    const directMatches = candidates.filter(c => {
      const t = (c.title + ' ' + c.parentTitle + ' ' + c.url).toLowerCase()
      const lectureMatch = queryLecture !== null && extractLectureNumber(t) === queryLecture
      const weekMatch    = queryWeek    !== null && extractWeekNumber(t)    === queryWeek
      // Both specified: require both to match; only one specified: require that one
      if (queryLecture !== null && queryWeek !== null) return lectureMatch && weekMatch
      return lectureMatch || weekMatch
    })

    if (directMatches.length > 0) {
      // Load the matching files first, then fill remaining slots with scored context
      directMatches.forEach(add)
    }
  }

  // ── Mode 2: fill remaining slots with scored candidates ──
  const byType = (types: SourceType[]) =>
    candidates.filter(c => types.includes(c.sourceType)).sort((a, b) => b.index - a.index)

  const scoredLectures = byType(['LECTURE'])
    .map(c => ({ c, score: scoreCandidate(c, queryWeek, queryLecture, queryLower) }))
    .sort((a, b) => b.score - a.score)

  const highValue  = byType(['PAST EXAM', 'FORMULA SHEET']).slice(0, 1)
  const remaining  = byType(['TUTORIAL', 'ASSIGNMENT', 'LAB', 'OTHER'])

  const fillCount = hasExplicitRef ? 1 : (isOverviewQuery ? 4 : 2)
  scoredLectures.slice(0, fillCount).forEach(x => add(x.c))
  highValue.forEach(add)
  remaining.forEach(add)

  return selected
}

// ── Intent detection ─────────────────────────────────────────────────────────

type Mode = 'brief' | 'teach' | 'practice' | 'test' | 'email'

function detectMode(message: string): Mode {
  const m = message.toLowerCase()
  if (/write (an?|the|a draft|me an?) email|draft (an?|me an?) email|compose (an?|me an?) email|email (to|the) (prof|professor|instructor|ta)/.test(m)) return 'email'
  // Full test: multiple questions, exam format
  if (/practice (test|exam)|mock (test|exam)|make.*(a |me a |me an )?(test|exam)|full (test|exam)|give me (a |an )?(practice )?(test|exam)/.test(m)) return 'test'
  // Single question: quiz, one problem
  if (/quiz me|give me a (question|problem)|test me on|exam me|one (question|problem)/.test(m)) return 'practice'
  if (/teach me|explain|i don.t understand|walk me through|how does|how do|what is |what are |why does|why is|i.m confused|help me understand/.test(m)) return 'teach'
  return 'brief'
}

// ── Course outline ───────────────────────────────────────────────────────────

function flattenOutline(modules: any[], depth = 0): string {
  let out = ''
  for (const mod of modules || []) {
    out += `${'  '.repeat(depth)}- ${mod.title}\n`
    for (const t of mod.topics || []) {
      out += `${'  '.repeat(depth + 1)}• ${t.title}\n`
    }
    out += flattenOutline(mod.modules || [], depth + 1)
  }
  return out
}

// ── Response parsing ─────────────────────────────────────────────────────────

function blocksToText(blocks: Block[]): string {
  return blocks.map((b: Block) => {
    if (b.type === 'summary')   return b.text
    if (b.type === 'bullets')   return b.items.join('\n')
    if (b.type === 'highlight') return b.text
    if (b.type === 'question')  return b.text
    return ''
  }).filter(Boolean).join('\n\n')
}

function parseBlocks(raw: string): { blocks: Block[]; text: string } {
  try {
    const json = JSON.parse(raw)
    // Standard: { blocks: [...] }
    if (Array.isArray(json.blocks) && json.blocks.length > 0) {
      return { blocks: json.blocks, text: blocksToText(json.blocks) }
    }
    // Model returned a bare block object: { type: "summary", text: "..." }
    if (typeof json.type === 'string') {
      const blocks = [json] as Block[]
      return { blocks, text: blocksToText(blocks) }
    }
    // Model returned a bare array of blocks: [{ type: ... }, ...]
    if (Array.isArray(json) && json.length > 0 && typeof json[0]?.type === 'string') {
      return { blocks: json as Block[], text: blocksToText(json as Block[]) }
    }
  } catch {}
  // Fallback: wrap plain text as a single summary block
  return { blocks: [{ type: 'summary', text: raw }], text: raw }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { message, history, courseId, courseCode, courseName } = await req.json()
  const mode = detectMode(message)
  const isOverviewQuery = /this week|last week|week \d|summarize|what('s| was) covered|overview of|go over/.test(message.toLowerCase())

  const fullName = (user.user_metadata?.full_name as string | undefined)?.trim()
  const studentName = fullName || user.email?.split('@')[0] || 'the student'

  let courseContext = ''
  const loadedSources: Source[] = []

  // Debug info returned to the client for dev inspection
  const debug: {
    session: string
    toc: string
    allPdfs: { title: string; parentTitle: string; sourceType: string; url: string }[]
    selectedPdfs: { title: string; sourceType: string; url: string }[]
    pdfResults: { title: string; url: string; cacheHit: boolean; chars: number; error?: string }[]
    grades: string
    announcements: string
    contextError?: string
  } = {
    session: 'not attempted',
    toc: 'not attempted',
    allPdfs: [],
    selectedPdfs: [],
    pdfResults: [],
    grades: 'not attempted',
    announcements: 'not attempted',
  }

  if (courseId) {
    try {
      const d2l = await getD2LSession(user.id)
      debug.session = d2l ? 'ok' : 'missing — no credentials in Supabase'

      if (d2l) {
        const orgUnitId = Number(courseId)
        const [tocRaw, gradesRaw, newsRaw] = await Promise.all([
          d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/content/toc`),
          d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/grades/values/myGradeValues/`),
          d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/news/`),
        ])

        // Marshal TOC
        let modules: any[] = []
        if (tocRaw?.Modules) {
          function marshalMod(m: any): any {
            return {
              title: m.Title,
              topics: (m.Topics || []).map((t: any) => ({ title: t.Title, url: t.Url || '' })),
              modules: (m.Modules || []).map(marshalMod),
            }
          }
          modules = tocRaw.Modules.map(marshalMod)
          const outline = flattenOutline(modules)
          if (outline) courseContext += `\nCOURSE OUTLINE:\n${outline}`
          debug.toc = `ok — ${modules.length} top-level modules`
        } else {
          debug.toc = tocRaw ? `no Modules key — got: ${JSON.stringify(tocRaw).slice(0, 120)}` : 'null response'
        }

        if (Array.isArray(gradesRaw)) {
          const gradeLines = gradesRaw
            .filter((g: any) => g.DisplayedGrade?.trim())
            .map((g: any) => `- ${g.GradeObjectName}: ${g.DisplayedGrade}`)
            .join('\n')
          if (gradeLines) courseContext += `\n\nSTUDENT GRADES:\n${gradeLines}`
          debug.grades = `${gradesRaw.length} items`
        } else {
          debug.grades = `non-array: ${JSON.stringify(gradesRaw).slice(0, 80)}`
        }

        if (Array.isArray(newsRaw)) {
          const lines = newsRaw.slice(0, 5).map((a: any) => {
            const date = a.CreatedDate ? ` (${new Date(a.CreatedDate).toLocaleDateString()})` : ''
            const body = (a.Body?.Text || a.Body?.Html || '')
              .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
            return `### ${a.Title ?? 'Announcement'}${date}\n${body}`
          }).join('\n\n')
          if (lines) courseContext += `\n\nCOURSE ANNOUNCEMENTS (instructor posts):\n${lines}`
          debug.announcements = `${newsRaw.length} items`
        } else {
          debug.announcements = `non-array: ${JSON.stringify(newsRaw).slice(0, 80)}`
        }

        if (modules.length > 0) {
          if (mode === 'email') {
            const syllabusUrl = findSyllabus(modules)
            if (syllabusUrl) {
              const text = await getPdfText(d2l, syllabusUrl)
              if (text) courseContext += `\n\nCOURSE SYLLABUS (use this to find instructor name, email, office hours):\n${text.slice(0, 2000)}`
            }
          }

          const candidates = collectCoursePdfs(modules)
          const selected   = selectSources(candidates, 3, message)
          const charsPerSource = isOverviewQuery ? 6000 : 2500

          debug.allPdfs      = candidates.map(c => ({ title: c.title, parentTitle: c.parentTitle, sourceType: c.sourceType, url: c.url }))
          debug.selectedPdfs = selected.map(c => ({ title: c.title, sourceType: c.sourceType, url: c.url }))

          let pdfContent = ''
          for (const candidate of selected) {
            const pdfDbg: PdfResult = { cacheHit: false, chars: 0 }
            const text = await getPdfText(d2l, candidate.url, pdfDbg)
            debug.pdfResults.push({ title: candidate.title, url: candidate.url, ...pdfDbg })
            if (text) {
              const filename = candidate.url.split('/').pop() || 'file.pdf'
              const label = candidate.title
                ? `${candidate.sourceType} — ${candidate.parentTitle ? `${candidate.parentTitle} / ` : ''}${candidate.title}`
                : candidate.sourceType
              pdfContent += `\n\n[${label}] ${filename}:\n${text.slice(0, charsPerSource)}`
              const fullUrl = candidate.url.startsWith('http') ? candidate.url : `https://${d2l.host}${candidate.url}`
              loadedSources.push({ filename, url: fullUrl, sourceType: candidate.sourceType, title: candidate.title })
            }
          }
          if (pdfContent) courseContext += `\n\nCOURSE MATERIALS:\n${pdfContent}`
        }
      }
    } catch (err: any) {
      debug.contextError = err?.message || String(err)
      console.error('[ask] course context error:', err)
    }
  }

  const courseIntro = courseId
    ? `The student is asking about ${courseCode}${courseName ? ` — ${courseName}` : ''}. You have real course materials below — use them for specific formulas, examples, and context.`
    : `Answer questions about the student's courses at Queen's University.`

  const sourceList = loadedSources.length > 0
    ? `\nAvailable source filenames for citation: ${loadedSources.map(s => s.filename).join(', ')}. IMPORTANT: Only include a filename in your response (in a cite field or inline) if you actually drew information from that file. Do not cite files you did not use.`
    : ''

  const modeInstructions: Record<Mode, string> = {
    brief: `
DETECTED MODE: BRIEF

First, decide which of these two sub-modes applies to the student's question:

━━ SUB-MODE A: DIRECT FACTUAL QUESTION ━━
If the student is asking a specific question (e.g. "when is the exam?", "what's my grade on assignment 2?", "is the lab due this week?", "who is the professor?"):
- Answer ONLY the specific question asked. Do NOT add unrequested info.
- If the answer is in the course data, state it directly in the summary block.
- If the answer is not available in the data you have, say so clearly and briefly — e.g. "I don't see the exam date posted anywhere — check your My Exam Schedule in SOLUS." Do not pad with related info unless the student asks.
- Block sequence: summary (the direct answer) → optional highlight if there's a critical caveat.

━━ SUB-MODE B: CONTENT OVERVIEW ━━
If the student is asking for a summary of material (e.g. "summarize week 9", "what's covered in the midterm?", "go over lecture 4"):
- Open the summary block by naming the specific source — e.g. "Week 9 Lecture 2 — Regression". Never open with a generic phrase without naming it.
- Give a thorough overview: all major concept sections, every formula introduced (write them out), any practice problems named explicitly.
- If the lecture includes practice problems, surface them in a highlight block: "This lecture included 3 practice problems: [name them]. Want me to walk through any?"
- Block sequence: summary → bullets (grouped by section) → highlight if relevant → one question at the end.`,

    teach: `
DETECTED MODE: TEACH — student wants to actually learn this concept, not read a summary.

You are tutoring one-on-one. Pick the SINGLE most foundational concept relevant to their request and teach it completely before moving to the next. Structure your response exactly as follows:

1. INTUITION (summary block): Plain English explanation a smart person with no background could follow. Use an analogy. No jargon in this block. 2–3 sentences max.

2. THE METHOD (bullets block, labeled "The method"):
   - One bullet per variable or term in the formula, explaining what it actually represents
   - Final bullet: the full formula in LaTeX with a plain-English description of what it computes
   - Example: "**$R^2$** · Ranges from 0 to 1. A value of 0.95 means 95% of the variation in $y$ is explained by your model — only 5% is noise or unexplained factors."

3. WORKED EXAMPLE (steps block, label: "Worked example"):
   - Make up a simple concrete dataset with real numbers (e.g. 3–4 data points)
   - Show every arithmetic step explicitly — do not skip steps or say "simplifying gives"
   - Write out each calculation: "Step 1: Compute $\\bar{x} = (2+4+6)/3 = 4$"
   - Show the final answer with units or context

4. CLOSE (question block): "Does that make sense? Here's one to try:" followed by a practice problem directly testing what was just taught.

Rules for teach mode:
- Cover ONE concept deeply. If asked "teach me week 9", start with the most foundational concept and offer to continue after.
- Every formula variable must be defined — never write $\\hat{b} = (X^TX)^{-1}X^Ty$ without explaining what $X$, $T$, and $y$ are
- Never use the word "simply" — it's dismissive
- The worked example must use real numbers the student can verify themselves`,

    practice: `
DETECTED MODE: PRACTICE — student wants one question to work through.

Generate ONE well-crafted problem drawn from the loaded course materials. Do not give the answer or solution yet.

CRITICAL — source discipline:
- Only reference topics, weeks, or concepts that appear explicitly in the COURSE MATERIALS section below.
- Do NOT invent week numbers or topic names. If you loaded "Week 9 Lecture 2 — Pendulums", say that. If no material was loaded, say "based on your course material" without a week number.
- The problem values (masses, lengths, etc.) should be realistic for the topic but do not need to come from a specific slide.

Block sequence:
- summary block: one sentence naming the exact source — e.g. "Here's a problem from Week 9 Lecture 2 — Pendulums." Use the material title from the COURSE MATERIALS label.
- question block: the full problem with all given values, what to solve for, any diagrams described in words. Write it like it would appear on a Queen's exam. Use $...$ for math.

After the student responds, grade their answer and show the full worked solution.`,

    test: `
DETECTED MODE: PRACTICE TEST — student wants a full multi-question exam.

Generate a practice test with 5 questions of escalating difficulty. Cover different topics from the loaded course materials — don't repeat the same concept twice.

CRITICAL — source discipline:
- Only test topics that appear in the COURSE MATERIALS section below. Do NOT invent weeks or topics.
- Vary question types: mix calculation problems, conceptual questions, and derivations.
- All 5 questions must appear in a single response — do not ask the student to say "next" between questions.

Block sequence:
- summary block: "Practice test — [X] questions covering [topic1], [topic2], … based on [source names from loaded materials]." Be specific about what's covered.
- highlight block: "Answer all questions before checking your work. Show full working for calculations."
- question blocks (numbered 1–5): each a complete, self-contained problem with all given values. Write exam-style. Use $...$ for math.

Do not provide answers or solutions until the student submits their responses.`,

    email: `
DETECTED MODE: EMAIL DRAFT — student wants a ready-to-send email.

Write a complete, professional email draft. Output it as a SINGLE summary block containing the full email as plain text — no labeled bullets, no structured fields. Format it exactly like a real email:

Subject: [subject line]

Dear [Professor/TA name if known from course data, otherwise "Professor [Last Name]"],

[Body — 2–3 sentences only. Ask ONLY what the student explicitly asked. Do not add extra questions, do not ask about topics the student did not mention, do not pad with "additionally" or "also".]

Best regards,
${studentName}

CRITICAL:
- The student's name is "${studentName}" — always sign with this exact name.
- SCOPE LOCK: Write only about what the student explicitly requested. If they asked about the exam date, ask ONLY about the exam date. Do NOT add questions about format, materials, or preparation topics unless the student specifically mentioned those.
- If the professor's name appears anywhere in the course announcements or materials, use it.
- If the course data already answers the exact question, write a short highlight block saying "Note: [the answer] is already posted — you may not need to send this."
- One summary block only. No other block types except optionally one highlight block for the above note.`
  }

  const bulletFormat = `
LIST FORMAT — bullets and numbered lists are both fine. Use whichever fits:
- Numbered lists (1. 2. 3.) for sequences, steps, ranked items, or anything with a natural order
- Bullet lists for parallel concepts, definitions, or unordered facts
- Each item is a rich markdown string: **Bold Label** · followed by 1–2 sentences of genuine explanation
- Include LaTeX formula where mathematical: "$\\hat{b} = (X^TX)^{-1}X^Ty$"
- Append "[View slide →](FILENAME.pdf#page=N)" if you know a specific slide number`

  const blockSchema = `
RESPONSE FORMAT: Return a JSON object with a "blocks" array. Raw JSON only — no markdown wrapping.

Block types:
- { "type": "summary", "text": "..." } — opening. Always exactly one, always first.
- { "type": "bullets", "items": ["...", ...] } — rich markdown items (see BULLET FORMAT). Up to 10 items. Use multiple bullets blocks for distinct sections.
- { "type": "highlight", "text": "..." } — callout for exam notes, warnings, practice problem lists.
- { "type": "steps", "label": "Worked example", "items": ["Step 1: ...", "Step 2: ..."] } — numbered steps for worked examples. Each step is a markdown string with full arithmetic shown.
- { "type": "question", "number": 1, "text": "...", "cite": "filename.pdf", "origin": "real" | "synthesized", "solution": ["Step 1: ...", "Step 2: ..."] } — a problem. Always include a "solution" array of step-by-step working. The UI hides it until the student clicks "Show Solution" — so write a complete, worked solution every time. Each step is a markdown string with full arithmetic shown. Set "origin": "real" ONLY when you reproduced a specific problem verbatim (or near-verbatim) from the loaded course materials — e.g. an actual past exam question, assignment problem, or numbered lecture example with given values. Set "origin": "synthesized" when you invented the problem values yourself based on the topic (even if the topic came from the materials). When origin is "real", set "cite" to the source filename.
- { "type": "choice", "items": ["...", ...] } — 2–4 clickable follow-up options the student can tap to continue. Each item is a short action phrase (under 8 words). The student clicking one sends it as their next message.

CHOICE BLOCK RULES — use sparingly, only where it genuinely helps:
  USE when: finishing a teach response (offer: worked example / quiz / go deeper on X)
  USE when: finishing a brief summary (offer: teach me a concept / quiz me / what's on the exam)
  USE when: the student answered a practice question (offer: show me the solution / give me another one / I got it right)
  USE when: the question is ambiguous and 2–3 paths are equally valid
  DO NOT use: mid-explanation, after a test (5 questions), when the student's intent is already obvious, or more than once per response.
  Items must be natural continuations — things the student would actually say next. Not generic ("Tell me more").

Math rules: $...$ inline, $$...$$ display. Never \\[...\\] or plain brackets.`

  const systemPrompt = `You are Quill, an AI study partner for Queen's University students. ${courseIntro}
The student's name is ${studentName}.

VOICE: Direct, warm, knowledgeable. Talk like a sharp friend who knows this material cold. Reference specific weeks, professors, exam dates when you know them.
${modeInstructions[mode]}
${bulletFormat}
${blockSchema}
${sourceList}${courseContext}`

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m: { role: string; content: string }) => ({
      role: m.role === 'quill' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: message },
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: mode === 'test' ? 4000 : mode === 'teach' ? 2000 : isOverviewQuery ? 2500 : 1600,
      response_format: { type: 'json_object' },
      messages,
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('[ask] OpenAI error:', res.status, errText.slice(0, 500))
    return NextResponse.json({ error: 'OpenAI error', detail: errText.slice(0, 200) }, { status: 502 })
  }
  const data = await res.json()
  if (!data.choices?.[0]?.message?.content) {
    console.error('[ask] OpenAI empty response:', JSON.stringify(data).slice(0, 300))
  }
  const raw  = data.choices?.[0]?.message?.content || '{"blocks":[{"type":"summary","text":"Sorry, I had trouble responding."}]}'

  const { blocks, text } = parseBlocks(raw)

  // Only surface sources the model actually referenced (filename appears in raw output or in a cite field)
  const referencedSources = loadedSources.filter(s => {
    const inText = raw.includes(s.filename)
    const inCite = blocks.some(b => b.type === 'question' && b.cite && s.filename.includes(b.cite.split('#')[0]))
    return inText || inCite
  })

  return NextResponse.json({ reply: text, blocks, sources: referencedSources, _debug: debug })
}
