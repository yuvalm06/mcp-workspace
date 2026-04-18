import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import type { ExamQuestion } from '../route'

export const maxDuration = 60

// ── Types ────────────────────────────────────────────────────────────────────

interface GradingResult {
  questionId: string
  correct: boolean
  score: number       // 0 to question.marks
  maxScore: number
  feedback: string
}

// ── GET — load session ───────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  const sb = supabaseServer()

  const { data, error } = await sb
    .from('practice_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

// ── PATCH — submit answers + grade ──────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  const { answers } = await req.json() as { answers: Record<string, string> }

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'answers object is required' }, { status: 400 })
  }

  // Load session
  const sb = supabaseServer()
  const { data: session, error: fetchError } = await sb
    .from('practice_sessions')
    .select('questions, total_marks, course_code')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const questions: ExamQuestion[] = session.questions
  const gradingResults: GradingResult[] = []

  // ── Grade MC automatically ────────────────────────────────────────────────
  const openQuestions: ExamQuestion[] = []
  for (const q of questions) {
    if (q.type === 'mc') {
      const studentAnswer = (answers[q.id] || '').trim().toUpperCase().charAt(0)
      const correct = studentAnswer === (q.correctAnswer || '').toUpperCase().charAt(0)
      gradingResults.push({
        questionId: q.id,
        correct,
        score: correct ? q.marks : 0,
        maxScore: q.marks,
        feedback: correct
          ? `Correct. ${q.solution?.[0] || ''}`
          : `The correct answer is ${q.correctAnswer}. ${q.solution?.[0] || ''}`,
      })
    } else {
      openQuestions.push(q)
    }
  }

  // ── Grade open questions via Claude Haiku ─────────────────────────────────
  if (openQuestions.length > 0) {
    const gradingPrompt = openQuestions.map(q => {
      const studentAnswer = answers[q.id] || '(no answer provided)'
      const solutionText = (q.solution || []).join('\n')
      return `QUESTION ID: ${q.id}
TYPE: ${q.type}
MARKS: ${q.marks}
QUESTION: ${q.question}
MODEL SOLUTION:
${solutionText}
STUDENT ANSWER: ${studentAnswer}`
    }).join('\n\n---\n\n')

    const gradingSystemPrompt = `You are grading student exam answers. For each question, compare the student's answer to the model solution and assign a score.

Be fair but rigorous:
- Award full marks if the answer is correct and shows appropriate working/reasoning
- Award partial marks for partially correct answers (show your calculation)
- Award 0 for answers that are wrong, missing, or show fundamental misunderstanding
- For short_answer and conceptual questions, judge on correctness of key ideas, not exact wording
- For problem questions, require correct method AND correct numerical result for full marks; award partial marks for correct method with arithmetic error

Return a JSON array — no fences, no preamble:
[
  {
    "questionId": "q2",
    "correct": true | false,
    "score": <number — 0 to question marks>,
    "maxScore": <marks from question>,
    "feedback": "1–2 sentences: what the student got right/wrong and the key insight they should take away"
  }
]`

    try {
      const gradingRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3-5-haiku',
          max_tokens: 2000,
          messages: [
            { role: 'system', content: gradingSystemPrompt },
            { role: 'user', content: gradingPrompt },
          ],
        }),
      })

      if (gradingRes.ok) {
        const gradingData = await gradingRes.json()
        const rawGrading = (gradingData.choices?.[0]?.message?.content || '').trim()
        const start = rawGrading.indexOf('[')
        const end   = rawGrading.lastIndexOf(']')
        if (start !== -1 && end !== -1) {
          const parsed: GradingResult[] = JSON.parse(rawGrading.slice(start, end + 1))
          gradingResults.push(...parsed)
        }
      }
    } catch (err: any) {
      console.error('[practice-exam] grading error:', err?.message)
      // Fall back to manual grading placeholder for open questions
      for (const q of openQuestions) {
        gradingResults.push({
          questionId: q.id,
          correct: false,
          score: 0,
          maxScore: q.marks,
          feedback: 'Could not auto-grade this answer. Review the model solution.',
        })
      }
    }
  }

  // ── Calculate total score ─────────────────────────────────────────────────
  const score = gradingResults.reduce((sum, r) => sum + r.score, 0)
  const totalMarks = session.total_marks || questions.reduce((s, q) => s + q.marks, 0)

  // Build grading map keyed by question id
  const gradingMap = Object.fromEntries(gradingResults.map(r => [r.questionId, r]))

  // ── Save to Supabase ──────────────────────────────────────────────────────
  const { error: updateError } = await sb
    .from('practice_sessions')
    .update({
      answers,
      grading:      gradingMap,
      score,
      total_marks:  totalMarks,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[practice-exam] update error:', updateError)
    return NextResponse.json({ error: 'Failed to save results' }, { status: 500 })
  }

  return NextResponse.json({ score, totalMarks, grading: gradingMap })
}
