import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  D2L_API, D2LSession, PdfResult, PdfCandidate, SourceType as D2LSourceType,
  getD2LSession, d2lGet, getPdfText, detectSourceType, SOURCE_TYPE_PRIORITY,
  findSyllabus, collectCoursePdfs, extractWeekNumber, extractLectureNumber,
  extractKeywords, scoreRelevance,
} from '@/lib/d2l'

// ── Types ────────────────────────────────────────────────────────────────────

export type SourceType = D2LSourceType

export type Block =
  | { type: 'text';      markdown: string }
  | { type: 'summary';   text: string }
  | { type: 'bullets';   items: string[] }
  | { type: 'highlight'; text: string }
  | { type: 'steps';     label?: string; items: string[] }
  | { type: 'question';  number?: number; text: string; cite?: string; solution?: string[]; origin?: 'real' | 'synthesized' }
  | { type: 'choice';    items: string[] }
  | { type: 'slide_ref'; cite: string; page: number; caption?: string }

export interface Source {
  filename: string
  url: string
  sourceType: SourceType
  title: string
}


// ── Source scoring ─────────────────────────────────────────────────────────────

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

  // Recency bonus: tiny tiebreaker only — explicit matches dominate
  score += c.index * 0.03

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
  const isExamQuery     = /exam|midterm|test|quiz|final|past (exam|test)|practice test/.test(queryLower)
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
      directMatches.forEach(add)
    }
  }

  // ── Mode 2: fill remaining slots with scored lectures ──
  // Also runs as full fallback when explicit ref was requested but direct matching found nothing
  const byType = (types: SourceType[]) =>
    candidates.filter(c => types.includes(c.sourceType)).sort((a, b) => b.index - a.index)

  const scoredLectures = byType(['LECTURE'])
    .map(c => ({ c, score: scoreCandidate(c, queryWeek, queryLecture, queryLower) }))
    .sort((a, b) => b.score - a.score)

  // If direct matching succeeded, don't fill with scored lectures.
  // If it found nothing (fallback), run scored fill as if no explicit ref was given.
  const directMatchSucceeded = hasExplicitRef && selected.length > 0
  const fillCount = directMatchSucceeded ? 0 : (isOverviewQuery ? 4 : 2)

  // Only pull past exams / formula sheets when the query is about exams/tests
  const pastExams = isExamQuery ? byType(['PAST EXAM', 'FORMULA SHEET']) : []
  const highValue = pastExams.slice(0, 1)
  // Only pull tutorials/other when no explicit lecture was requested (and direct match didn't succeed)
  const remaining = (!directMatchSucceeded && isOverviewQuery) ? byType(['TUTORIAL', 'ASSIGNMENT', 'LAB', 'OTHER']) : []
  // Exam fallback: if no past exams exist, use scored tutorials/ICAs/other as context
  // (handles courses that only have in-class activity files, no past exams)
  const examFallback = (isExamQuery && pastExams.length === 0 && !directMatchSucceeded)
    ? byType(['TUTORIAL', 'ASSIGNMENT', 'LAB', 'OTHER'])
        .map(c => ({ c, score: scoreCandidate(c, queryWeek, queryLecture, queryLower) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(x => x.c)
    : []
  scoredLectures.slice(0, fillCount).forEach(x => add(x.c))
  highValue.forEach(add)
  examFallback.forEach(add)
  remaining.forEach(add)

  return selected
}

// ── Intent detection ─────────────────────────────────────────────────────────

type Mode = 'brief' | 'teach' | 'practice' | 'test' | 'email'

function detectMode(message: string, history: { role: string }[] = []): Mode {
  const m = message.toLowerCase().trim()
  if (/write (an?|the|a draft|me an?) email|draft (an?|me an?) email|compose (an?|me an?) email|email (to|the) (prof|professor|instructor|ta)/.test(m)) return 'email'
  if (/practice (test|exam)|mock (test|exam)|make.*(a |me a |me an )?(test|exam)|full (test|exam)|give me (a |an )?(practice )?(test|exam)/.test(m)) return 'test'
  if (/quiz me|give me a (question|problem)|test me on|exam me|one (question|problem)/.test(m)) return 'practice'
  if (/teach me|explain|i don.t understand|walk me through|how does|how do|what is |what are |why does|why is|i.m confused|help me understand/.test(m)) return 'teach'
  // "next" / "continue" in a teach session → stay in teach mode
  if (/^(next|continue|next section|go on|keep going|next:)/.test(m) && history.length > 0) return 'teach'
  if (/^practice problem on/.test(m) && history.length > 0) return 'practice'
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
    if (b.type === 'text')      return b.markdown ?? ''
    if (b.type === 'summary')   return b.text ?? ''
    if (b.type === 'bullets')   return Array.isArray(b.items) ? b.items.join('\n') : ''
    if (b.type === 'highlight') return b.text ?? ''
    if (b.type === 'steps')     return Array.isArray(b.items) ? ((b.label ? b.label + '\n' : '') + b.items.join('\n')) : ''
    if (b.type === 'question')  return b.text ?? ''
    if (b.type === 'choice')    return Array.isArray(b.items) ? b.items.join(' | ') : ''
    if (b.type === 'slide_ref') return b.caption ?? b.cite ?? ''
    return ''
  }).filter(Boolean).join('\n\n')
}

// Sanitize JSON strings to fix issues Claude commonly introduces:
//   1. Literal (unescaped) newlines / carriage returns / tabs inside string values
//   2. Invalid JSON escape sequences like \i, \a, \p (from LaTeX: \int, \alpha, \partial)
//      JSON only allows: \" \\ \/ \b \f \n \r \t \uXXXX
//      Anything else (e.g. \i from $\int$) is invalid → replace with \\char
const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

function sanitizeJsonStrings(s: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (escaped) {
      if (VALID_JSON_ESCAPES.has(c)) {
        // Valid escape — pass through as-is
        result += c
        // \uXXXX — consume the 4 hex digits so they aren't re-processed
        if (c === 'u') {
          result += s.slice(i + 1, i + 5)
          i += 4
        }
      } else {
        // Invalid escape (e.g. \i, \a from LaTeX) — double the backslash
        result += '\\' + c
      }
      escaped = false
    } else if (c === '\\' && inString) {
      result += c
      escaped = true
    } else if (c === '"') {
      result += c
      inString = !inString
    } else if (inString && (c === '\n' || c === '\r')) {
      result += '\\n'
    } else if (inString && c === '\t') {
      result += '\\t'
    } else {
      result += c
    }
  }
  return result
}

function parseBlocks(raw: string): { blocks: Block[]; text: string } {
  const tryParse = (s: string) => {
    // Step 1: parse JSON — legitimate parse errors return null
    let json: any
    try { json = JSON.parse(s) } catch { return null }

    // Step 2: extract blocks array from whatever structure Claude returned
    let blocks: Block[] | null = null
    if (Array.isArray(json.blocks) && json.blocks.length > 0) {
      blocks = json.blocks as Block[]
      // Claude sometimes puts the choice block at root level outside blocks[]
      if (json.type === 'choice' && Array.isArray(json.items) && !blocks.some(b => b.type === 'choice')) {
        blocks.push({ type: 'choice', items: json.items })
      }
    } else if (typeof json.type === 'string') {
      blocks = [json] as Block[]
    } else if (Array.isArray(json) && json.length > 0 && typeof json[0]?.type === 'string') {
      blocks = json as Block[]
    }
    if (!blocks || blocks.length === 0) return null

    // Step 3: convert to plain text separately — don't let this kill the parse
    let text = ''
    try { text = blocksToText(blocks) } catch { /* blocksToText is now null-safe, but belt-and-suspenders */ }
    return { blocks, text }
  }

  // Extract the JSON object — handles code fences, preamble text, postamble, anything
  // Search for {"blocks": specifically so we don't get tripped by { in preamble text
  const blocksKeyIdx = raw.search(/\{\s*"blocks"\s*:/)
  const jsonEnd      = raw.lastIndexOf('}')
  const base = (blocksKeyIdx !== -1 && jsonEnd > blocksKeyIdx)
    ? raw.slice(blocksKeyIdx, jsonEnd + 1)
    : raw.trim()

  // Sanitize literal newlines inside JSON string values (Claude puts math on its own lines)
  const sanitized = sanitizeJsonStrings(base)

  // 1. Primary: sanitized extracted JSON
  const clean = tryParse(sanitized)
  if (clean) return clean

  // 2. Fallback: unsanitized in case sanitizer mangled something unusual
  if (sanitized !== base) {
    const direct = tryParse(base)
    if (direct) return direct
  }

  // 3. Truncation rescue — find last complete block in sanitized string
  try {
    const blocksStart = sanitized.indexOf('"blocks"')
    if (blocksStart !== -1) {
      const arrStart = sanitized.indexOf('[', blocksStart)
      if (arrStart !== -1) {
        let partial = sanitized.slice(arrStart)
        const lastComplete = Math.max(partial.lastIndexOf('},'), partial.lastIndexOf('"}'))
        if (lastComplete > 0) {
          partial = partial.slice(0, lastComplete + 1) + ']'
          const rescued = tryParse(`{"blocks":${partial}}`)
          if (rescued && rescued.blocks.length > 0) return rescued
        }
      }
    }
  } catch {}

  // 4. Last resort: log and return plain text
  console.error('[parseBlocks] all parse attempts failed. raw (first 600):', raw.slice(0, 600))
  return { blocks: [{ type: 'summary', text: raw }], text: raw }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { message, history, courseId, courseCode, courseName } = await req.json()
  const mode = detectMode(message, history)
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
        const isGradeQuery = /grade|mark|score|how did i do|assignment \d|quiz \d|test \d|midterm result/.test(message.toLowerCase())
        const isAnnouncementQuery = /announcement|news|posted|professor said|instructor said|update|reminder/.test(message.toLowerCase())

        const [tocRaw, gradesRaw, newsRaw] = await Promise.all([
          d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/content/toc`),
          isGradeQuery ? d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/grades/values/myGradeValues/`) : Promise.resolve(null),
          isAnnouncementQuery ? d2lGet(d2l, `/d2l/api/le/${D2L_API}/${orgUnitId}/news/`) : Promise.resolve(null),
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
          // For teach continuations ("next", "continue"), re-use the original
          // teach query from history so source selection stays on the same lecture
          const isContinuation = mode === 'teach' && /^(next|continue|next section|go on|keep going)/i.test(message.trim())
          const selectionQuery = isContinuation
            ? (history as { role: string; content: string }[]).find(m => m.role === 'user')?.content ?? message
            : message
          const selected   = selectSources(candidates, 3, selectionQuery)
          const charsPerSource = isOverviewQuery ? 6000 : mode === 'teach' ? 5000 : 3000

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

          // ── Phase 1: Related practice materials ─────────────────────────────
          // In teach/practice/test modes, find tutorials & assignments whose
          // cached text overlaps topically with the loaded lecture content.
          // This lets the model know what kinds of questions this material generates
          // without explicitly teaching them — purely awareness/calibration context.
          if (['teach', 'practice', 'test'].includes(mode) && pdfContent.length > 0) {
            const practiceCandidates = candidates.filter(c =>
              ['TUTORIAL', 'ASSIGNMENT', 'LAB'].includes(c.sourceType) &&
              !loadedSources.some(s => s.url.endsWith(c.url) || c.url.endsWith(s.filename))
            )
            if (practiceCandidates.length > 0) {
              const practiceUrls = practiceCandidates.map(c => c.url)
              const { data: cached } = await supabaseServer()
                .from('pdf_cache')
                .select('url, text')
                .in('url', practiceUrls)

              if (cached && cached.length > 0) {
                const keywords = extractKeywords(pdfContent)
                const scored = cached
                  .filter(file => typeof file.text === 'string' && file.text.length > 0)
                  .map(file => ({
                    ...file,
                    meta: practiceCandidates.find(p => p.url === file.url)!,
                    score: scoreRelevance(file.text, keywords),
                  }))
                  .filter(f => f.score > 5 && f.meta)
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 2)

                if (scored.length > 0) {
                  let practiceCtx = '\n\nRELATED PRACTICE MATERIALS (for calibration only — use to understand the style and difficulty of questions this topic generates; do not solve them unless explicitly asked):\n'
                  for (const item of scored) {
                    const filename = item.url.split('/').pop() || 'file.pdf'
                    practiceCtx += `\n[${item.meta.sourceType} — ${item.meta.parentTitle ? `${item.meta.parentTitle} / ` : ''}${item.meta.title}] ${filename}:\n${item.text.slice(0, 2500)}\n`
                  }
                  courseContext += practiceCtx
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      debug.contextError = err?.message || String(err)
      console.error('[ask] course context error:', err)
    }
  }

  const materialsLoaded = loadedSources.length > 0
  const courseIntro = courseId
    ? `The student is asking about ${courseCode}${courseName ? ` — ${courseName}` : ''}.${materialsLoaded ? ' You have real course materials below — use them to understand what was taught in this course (topics, scope, examples, notation). Then teach and explain those concepts using your full knowledge and understanding. The materials tell you *what* was covered — your job is to explain *why* it works, build intuition, and make it click. Do not invent topics not in the materials, but never limit your explanations to just what the slides say.' : ' IMPORTANT: No course materials were loaded for this request. Do not answer course-specific questions (lecture content, formulas, examples) from training data — you will hallucinate the wrong course content. Instead, tell the student you could not load the materials and ask them to try again.'}`
    : `Answer general questions about university coursework. If the student asks about specific lecture content, tell them to select their course first.`

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
DETECTED MODE: TEACH.

Teach this lecture using the following format — exactly this style, no deviation:

1. Open with one line: "Good. We go step by step. Say **next** when ready."
2. Cover 3–5 concepts from the lecture, each as a numbered step:

---
**Step N. [Concept name]**

Core idea: [One sentence. Then a short punchy follow-up on its own line if it helps.]

- [bullet: short fact or component]
- [bullet: short fact or component]

Key idea: [One sentence takeaway — the thing they must not forget.]

---

3. End with a hard stop:
"Stop here. Say **next** and I'll teach: [bullet list of what comes next in the lecture]"

Rules:
- Each step must fit in ~50 words. If it doesn't, cut it.
- No filler. "Core idea:" is a label, not a sentence opener like "The core idea is that..."
- [PROFESSOR NOTE], [EMPHASIS], [HANDWRITTEN] tags in the materials = high signal. Surface them.
- Check the conversation history — if the student said "next", continue from where you left off. Do not repeat.
- Use a text block for the main content. Use a choice block at the end with "Next" and one other option.`,

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
RESPONSE FORMAT: Return a JSON object with a "blocks" array. Raw JSON only — no markdown wrapping, no code fences, no \`\`\`json. Start your response with { and end with }.

Block types:
- { "type": "text", "markdown": "..." } — free-form markdown. Use for natural prose, mixed explanations, anything that doesn't fit a rigid structure. Supports bold, italic, lists, LaTeX math ($...$), headers. Preferred in teach mode.
- { "type": "summary", "text": "..." } — opening. Always exactly one, always first.
- { "type": "bullets", "items": ["...", ...] } — rich markdown items (see BULLET FORMAT). Up to 10 items. Use multiple bullets blocks for distinct sections.
- { "type": "highlight", "text": "..." } — callout for exam notes, warnings, practice problem lists.
- { "type": "steps", "label": "Worked example", "items": ["Step 1: ...", "Step 2: ..."] } — numbered steps for worked examples. Each step is a markdown string with full arithmetic shown.
- { "type": "question", "number": 1, "text": "...", "cite": "filename.pdf", "origin": "real" | "synthesized", "solution": ["Step 1: ...", "Step 2: ..."] } — a problem. Always include a "solution" array of step-by-step working. The UI hides it until the student clicks "Show Solution" — so write a complete, worked solution every time. Each step is a markdown string with full arithmetic shown. Set "origin": "real" ONLY when you reproduced a specific problem verbatim (or near-verbatim) from the loaded course materials — e.g. an actual past exam question, assignment problem, or numbered lecture example with given values. Set "origin": "synthesized" when you invented the problem values yourself based on the topic (even if the topic came from the materials). When origin is "real", set "cite" to the source filename.
- { "type": "slide_ref", "cite": "filename.pdf", "page": N, "caption": "..." } — reference to a specific slide from the course materials. Use when explaining a concept that has a diagram, figure, or worked example on a specific page of the loaded PDFs. The extracted PDF text includes "Page N:" markers — use those to identify the right page number. "cite" must be the exact filename (e.g. "04_Lecture04_MECH241_W26.pdf"). "caption" is a short description of what the student will see (e.g. "Velocity profile between moving and stationary plate"). Place immediately after the concept it illustrates. Only use if you can identify the exact page number from the extracted text — never guess a page number.
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

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model: 'anthropic/claude-3-5-haiku',
      max_tokens: mode === 'test' ? 4000 : mode === 'teach' ? 1200 : isOverviewQuery ? 2500 : 1600,
      messages,
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('[ask] model error:', res.status, errText.slice(0, 500))
    return NextResponse.json({ error: 'model error', detail: errText.slice(0, 200) }, { status: 502 })
  }
  const data = await res.json()
  if (!data.choices?.[0]?.message?.content) {
    console.error('[ask] OpenRouter empty response:', JSON.stringify(data).slice(0, 300))
  }
  const raw  = data.choices?.[0]?.message?.content || '{"blocks":[{"type":"summary","text":"Sorry, I had trouble responding."}]}'

  const { blocks, text } = parseBlocks(raw)

  // Surface all loaded sources — the model was given these materials as context,
  // so the answer is grounded in them even when the model doesn't cite a filename.
  return NextResponse.json({ reply: text, blocks, sources: loadedSources, _debug: debug })
}
