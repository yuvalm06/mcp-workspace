import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  D2L_API, getD2LSession, d2lGet, getPdfText,
  collectCoursePdfs, findSyllabus, SOURCE_TYPE_PRIORITY,
} from '@/lib/d2l'

export const maxDuration = 120

// ── Types ────────────────────────────────────────────────────────────────────

export type QuestionType = 'mc' | 'short_answer' | 'problem' | 'conceptual'

export interface ExamQuestion {
  id: string
  type: QuestionType
  topic: string
  question: string
  options?: string[]      // MC only — exactly 4
  correctAnswer?: string  // MC only — 'A' | 'B' | 'C' | 'D'
  solution: string[]      // step-by-step working, always present
  marks: number
  sourceHint?: string
}

interface GeneratedExam {
  examTitle: string
  examDescription: string
  totalEstimatedMinutes: number
  basedOn: string[]
  questions: ExamQuestion[]
}

// ── Outline builder ──────────────────────────────────────────────────────────

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

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { courseId, courseCode, courseName } = await req.json()
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
  const outline = flattenOutline(modules)

  // ── 3. Collect ALL PDFs, sort by priority ───────────────────────────────────
  const allPdfs = collectCoursePdfs(modules)
  const sorted = [...allPdfs].sort((a, b) => {
    const pa = SOURCE_TYPE_PRIORITY[a.sourceType]
    const pb = SOURCE_TYPE_PRIORITY[b.sourceType]
    if (pa !== pb) return pa - pb
    // Within same type: most recent first
    return b.index - a.index
  })

  // ── 4. Load content — generous budget for one-time generation ───────────────
  // Past exams + formula sheets get full text; lectures get 8k chars each;
  // assignments/tutorials get 5k each. Total cap: 70k chars.
  const BUDGET_RICH  = 12000   // past exams, formula sheets — load as much as possible
  const BUDGET_STD   = 8000    // lectures
  const BUDGET_SUPP  = 5000    // assignments, tutorials, labs
  const MAX_TOTAL    = 70000

  let totalChars = 0
  let courseContent = ''
  const loadedFiles: string[] = []

  // Load syllabus separately (trimmed — we only need structure/schedule info)
  const syllabusUrl = findSyllabus(modules)
  if (syllabusUrl) {
    const text = await getPdfText(d2l, syllabusUrl)
    if (text) {
      const chunk = text.slice(0, 4000)
      courseContent += `\n\n[SYLLABUS]:\n${chunk}`
      totalChars += chunk.length
      loadedFiles.push('Syllabus')
    }
  }

  for (const pdf of sorted) {
    if (totalChars >= MAX_TOTAL) break

    const budget = (['PAST EXAM', 'FORMULA SHEET'] as const).includes(pdf.sourceType as any)
      ? BUDGET_RICH
      : pdf.sourceType === 'LECTURE'
        ? BUDGET_STD
        : BUDGET_SUPP

    const text = await getPdfText(d2l, pdf.url)
    if (!text) continue

    const chunk = text.slice(0, budget)
    const label = `[${pdf.sourceType}${pdf.parentTitle ? ` — ${pdf.parentTitle}` : ''} / ${pdf.title}]`
    courseContent += `\n\n${label}:\n${chunk}`
    totalChars += chunk.length
    loadedFiles.push(`${pdf.sourceType}: ${pdf.title}`)
  }

  if (!courseContent.trim()) {
    return NextResponse.json(
      { error: 'No course content found. Make sure your OnQ connection is active and the course has materials.' },
      { status: 422 }
    )
  }

  // ── 5. Count source types for context ───────────────────────────────────────
  const typeCounts = allPdfs.reduce<Record<string, number>>((acc, pdf) => {
    acc[pdf.sourceType] = (acc[pdf.sourceType] || 0) + 1
    return acc
  }, {})
  const availableSummary = Object.entries(typeCounts)
    .map(([t, n]) => `${n} ${t.toLowerCase()}${n !== 1 ? 's' : ''}`)
    .join(', ')

  // ── 6. Build generation prompt ──────────────────────────────────────────────
  const systemPrompt = `You are generating a practice exam for a university student enrolled in ${courseCode}${courseName ? ` — ${courseName}` : ''}.

You have been given the complete contents of this course: the full outline, syllabus, all lectures, past exams, assignments, formula sheets, and supplementary materials — everything available (${availableSummary}).

Think like the professor who designed this course:

1. Survey the outline and materials to understand what this course covers and how it is structured
2. Identify the core concepts, skills, and problem-solving patterns that students are expected to master
3. If past exams or assignments are available, study them carefully — understand the style, difficulty level, question formats, and which concepts are emphasized
4. Use the syllabus (if present) to check for topics that appear in the outline but may not have corresponding materials yet — acknowledge gaps honestly
5. Generate a practice exam that genuinely mirrors how this course assesses students

QUESTION DESIGN — follow the course's lead, not a template:
- The number of questions should match the course's assessment style (if past exams have 10 questions, generate ~10; if the course is small with little content, generate fewer)
- The mix of types (mc, short_answer, problem, conceptual) should match what you see in the assessments — don't invent a format the course doesn't use
- For calculation-heavy engineering/math courses: more numerical problems with given values
- For theory/science/humanities courses: more conceptual and short-answer
- Difficulty should span easy → medium → hard, with the distribution matching the course's typical exams
- Every problem must use values and contexts that are realistic for the discipline

SOLUTION QUALITY:
- Every question must have a complete, step-by-step solution — even multiple choice
- For MC, explain why each wrong option is wrong (briefly)
- For problems, show all working with intermediate values
- Solutions are hidden from the student during the exam; write them for someone who got the question wrong

Return a raw JSON object only — no markdown fences, no preamble. Start your response with { and end with }:
{
  "examTitle": "Practice Exam — [CODE]: [brief scope, e.g. 'Midterm 1 Material' or 'Full Course Review' or 'Weeks 1–8']",
  "examDescription": "2–3 sentences: what this exam covers, how many questions, what it's based on, and any notable gaps if topics from the outline weren't supported by materials",
  "totalEstimatedMinutes": <number>,
  "basedOn": ["source 1", "source 2"],
  "questions": [
    {
      "id": "q1",
      "type": "mc" | "short_answer" | "problem" | "conceptual",
      "topic": "exact topic name as it appears in the course (e.g. 'Reynolds Transport Theorem', 'Market Equilibrium')",
      "question": "Full question text. Use $...$ for inline math. Use $$...$$ for display equations. Write clearly — no ambiguity.",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correctAnswer": "A",
      "solution": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
      "marks": <integer>,
      "sourceHint": "Week 9 — Pipe Flow"
    }
  ]
}`

  // ── 7. Call Claude Sonnet ───────────────────────────────────────────────────
  const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: 8000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `COURSE OUTLINE:\n${outline}\n\nCOURSE MATERIALS:\n${courseContent}\n\nGenerate the practice exam now.`,
        },
      ],
    }),
  })

  if (!aiRes.ok) {
    const errText = await aiRes.text()
    console.error('[practice-exam] AI error:', aiRes.status, errText.slice(0, 400))
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  const aiData = await aiRes.json()
  const raw = (aiData.choices?.[0]?.message?.content || '').trim()

  // ── 8. Parse response ───────────────────────────────────────────────────────
  let exam: GeneratedExam
  try {
    const start = raw.indexOf('{')
    const end   = raw.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('No JSON object found')
    const jsonStr = raw.slice(start, end + 1)
    exam = JSON.parse(jsonStr)
    if (!Array.isArray(exam.questions) || exam.questions.length === 0) {
      throw new Error('questions array is empty')
    }
  } catch (err: any) {
    console.error('[practice-exam] parse error:', err?.message, '\nraw:', raw.slice(0, 600))
    return NextResponse.json({ error: 'Failed to parse generated exam' }, { status: 500 })
  }

  // ── 9. Save to Supabase ─────────────────────────────────────────────────────
  const sb = supabaseServer()
  const totalMarks = exam.questions.reduce((sum, q) => sum + (q.marks || 1), 0)

  const { data: session, error: insertError } = await sb
    .from('practice_sessions')
    .insert({
      user_id:                  user.id,
      course_id:                String(courseId),
      course_code:              courseCode,
      course_name:              courseName || null,
      exam_title:               exam.examTitle,
      exam_description:         exam.examDescription,
      total_estimated_minutes:  exam.totalEstimatedMinutes,
      based_on:                 exam.basedOn || [],
      questions:                exam.questions,
      total_marks:              totalMarks,
    })
    .select('id')
    .single()

  if (insertError || !session) {
    console.error('[practice-exam] insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save session' }, { status: 500 })
  }

  return NextResponse.json({
    sessionId:              session.id,
    questions:              exam.questions,
    examTitle:              exam.examTitle,
    examDescription:        exam.examDescription,
    totalEstimatedMinutes:  exam.totalEstimatedMinutes,
    basedOn:                exam.basedOn || [],
    totalMarks,
  })
}
