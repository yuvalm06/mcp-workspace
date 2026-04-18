'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { ExamQuestion } from '@/app/api/practice-exam/route'
import s from './page.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type GradingResult = {
  questionId: string
  correct: boolean
  score: number
  maxScore: number
  feedback: string
}

type SessionData = {
  id: string
  course_code: string
  course_name: string | null
  course_id: string
  exam_title: string
  exam_description: string
  total_estimated_minutes: number
  based_on: string[]
  questions: ExamQuestion[]
  total_marks: number
  answers: Record<string, string> | null
  grading: Record<string, GradingResult> | null
  score: number | null
  completed_at: string | null
}

type Phase = 'loading' | 'taking' | 'submitting' | 'results'

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MD({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

// ── Score ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, total }: { score: number; total: number }) {
  const pct  = total > 0 ? score / total : 0
  const r    = 42
  const circ = 2 * Math.PI * r
  const dash = pct * circ

  const color = pct >= 0.8 ? '#2B7A4B' : pct >= 0.6 ? '#C07030' : '#D45050'

  return (
    <svg width={108} height={108} viewBox="0 0 108 108">
      <circle cx={54} cy={54} r={r} fill="none" stroke="var(--border)" strokeWidth={7} />
      <circle
        cx={54} cy={54} r={r}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 54 54)"
        style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.23, 1, 0.32, 1)' }}
      />
      <text x={54} y={50} textAnchor="middle" className={s.ringScore} fill={color}>{score}</text>
      <text x={54} y={64} textAnchor="middle" className={s.ringTotal} fill="var(--ink-ghost)">/{total}</text>
    </svg>
  )
}

// ── Question card ─────────────────────────────────────────────────────────────

function QuestionCard({
  q,
  index,
  answer,
  onChange,
  grading,
  showResults,
}: {
  q: ExamQuestion
  index: number
  answer: string
  onChange: (val: string) => void
  grading?: GradingResult
  showResults: boolean
}) {
  const [solutionOpen, setSolutionOpen] = useState(false)
  const answered = answer.trim().length > 0

  const resultColor = !showResults
    ? undefined
    : grading
      ? (grading.correct ? '#2B7A4B' : grading.score > 0 ? '#C07030' : '#D45050')
      : undefined

  return (
    <div
      className={`${s.qCard} ${showResults && grading ? (grading.correct ? s.qCardCorrect : grading.score > 0 ? s.qCardPartial : s.qCardWrong) : ''}`}
      style={resultColor ? { '--q-accent': resultColor } as React.CSSProperties : undefined}
    >
      {/* Header row */}
      <div className={s.qHeader}>
        <div className={s.qNum}>{index + 1}</div>
        <div className={s.qMeta}>
          <span className={s.qTopic}>{q.topic}</span>
          <span className={s.qMarks}>{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
        </div>
        {showResults && grading && (
          <div className={s.qScore} style={{ color: resultColor }}>
            {grading.score}/{grading.maxScore}
          </div>
        )}
      </div>

      {/* Question text */}
      <MD className={s.qText}>{q.question}</MD>

      {/* Source hint */}
      {q.sourceHint && !showResults && (
        <p className={s.qHint}>{q.sourceHint}</p>
      )}

      {/* Answer area */}
      {!showResults && (
        <div className={s.answerArea}>
          {q.type === 'mc' && q.options ? (
            <div className={s.mcOptions}>
              {q.options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i) // A, B, C, D
                const selected = answer === letter
                return (
                  <button
                    key={letter}
                    className={`${s.mcOption} ${selected ? s.mcOptionSelected : ''}`}
                    onClick={() => onChange(selected ? '' : letter)}
                  >
                    <span className={s.mcLetter}>{letter}</span>
                    <MD className={s.mcText}>{opt.replace(/^[A-D]\.\s*/i, '')}</MD>
                  </button>
                )
              })}
            </div>
          ) : (
            <textarea
              className={`${s.textarea} ${answered ? s.textareaFilled : ''}`}
              placeholder={
                q.type === 'problem'
                  ? 'Show your working step by step…'
                  : q.type === 'short_answer'
                    ? 'Write your answer…'
                    : 'Explain your reasoning…'
              }
              value={answer}
              onChange={e => onChange(e.target.value)}
              rows={5}
            />
          )}
        </div>
      )}

      {/* Results view */}
      {showResults && (
        <div className={s.resultsView}>
          {/* Student's answer */}
          <div className={s.studentAnswer}>
            <p className={s.resultLabel}>Your answer</p>
            {q.type === 'mc' && q.options ? (
              <div className={s.mcOptions}>
                {q.options.map((opt, i) => {
                  const letter = String.fromCharCode(65 + i)
                  const isStudentAnswer = answer === letter
                  const isCorrect = letter === q.correctAnswer
                  return (
                    <div
                      key={letter}
                      className={`${s.mcOption} ${s.mcOptionReview} ${isStudentAnswer ? s.mcOptionReviewed : ''} ${isCorrect ? s.mcOptionCorrect : ''} ${isStudentAnswer && !isCorrect ? s.mcOptionIncorrect : ''}`}
                    >
                      <span className={s.mcLetter}>{letter}</span>
                      <MD className={s.mcText}>{opt.replace(/^[A-D]\.\s*/i, '')}</MD>
                      {isCorrect && <span className={s.mcCheck}>✓</span>}
                      {isStudentAnswer && !isCorrect && <span className={s.mcX}>✗</span>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={s.submittedAnswer}>
                {answer.trim() ? <MD>{answer}</MD> : <p className={s.noAnswer}>No answer submitted</p>}
              </div>
            )}
          </div>

          {/* Feedback */}
          {grading?.feedback && (
            <div className={s.feedbackBox} style={{ borderLeftColor: resultColor }}>
              <p className={s.feedbackText}>{grading.feedback}</p>
            </div>
          )}

          {/* Solution toggle */}
          <button className={s.solutionToggle} onClick={() => setSolutionOpen(o => !o)}>
            <span className={`${s.solutionChevron} ${solutionOpen ? s.solutionChevronOpen : ''}`}>›</span>
            {solutionOpen ? 'Hide solution' : 'View full solution'}
          </button>
          {solutionOpen && (
            <div className={s.solutionSteps}>
              {(q.solution || []).map((step, i) => (
                <div key={i} className={s.solutionStep}>
                  <span className={s.solutionStepNum}>{i + 1}</span>
                  <MD className={s.solutionStepText}>{step}</MD>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function PracticePageInner() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string

  const [phase,      setPhase]      = useState<Phase>('loading')
  const [session,    setSession]    = useState<SessionData | null>(null)
  const [answers,    setAnswers]    = useState<Record<string, string>>({})
  const [grading,    setGrading]    = useState<Record<string, GradingResult>>({})
  const [score,      setScore]      = useState(0)
  const [totalMarks, setTotalMarks] = useState(0)
  const [error,      setError]      = useState<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  // Load session
  useEffect(() => {
    fetch(`/api/practice-exam/${sessionId}`)
      .then(r => r.json())
      .then((data: SessionData & { error?: string }) => {
        if (data.error) { setError(data.error); return }
        setSession(data)
        setTotalMarks(data.total_marks || data.questions.reduce((s, q) => s + q.marks, 0))
        // Resume completed session
        if (data.completed_at && data.grading && data.answers) {
          setAnswers(data.answers)
          setGrading(data.grading)
          setScore(data.score || 0)
          setPhase('results')
        } else {
          setPhase('taking')
        }
      })
      .catch(() => setError('Could not load this practice session.'))
  }, [sessionId])

  const setAnswer = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  const answeredCount = session
    ? session.questions.filter(q => (answers[q.id] || '').trim().length > 0).length
    : 0

  const handleSubmit = async () => {
    if (!session) return
    setPhase('submitting')
    topRef.current?.scrollIntoView({ behavior: 'smooth' })

    try {
      const res = await fetch(`/api/practice-exam/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Grading failed')
      setGrading(data.grading)
      setScore(data.score)
      setTotalMarks(data.totalMarks)
      setPhase('results')
    } catch (err: any) {
      setError(err.message || 'Failed to grade exam')
      setPhase('taking')
    }
  }

  const pct = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0
  const resultLabel = pct >= 80 ? 'Strong result' : pct >= 60 ? 'Getting there' : 'Needs more review'

  // ── Loading / error states ─────────────────────────────────────────────────
  if (error) {
    return (
      <div className={s.center}>
        <p className={s.errorMsg}>{error}</p>
        <button className={s.backBtn} onClick={() => router.back()}>← Go back</button>
      </div>
    )
  }

  if (phase === 'loading' || !session) {
    return (
      <div className={s.center}>
        <div className={s.spinner} />
        <p className={s.loadingLabel}>Loading exam…</p>
      </div>
    )
  }

  // ── Submitting ─────────────────────────────────────────────────────────────
  if (phase === 'submitting') {
    return (
      <div className={s.center}>
        <div className={s.spinner} />
        <p className={s.loadingLabel}>Grading your answers…</p>
        <p className={s.loadingSubLabel}>This takes about 10 seconds</p>
      </div>
    )
  }

  return (
    <div className={s.wrap} ref={topRef}>
      <div className={s.inner}>

        {/* ── Header ── */}
        <div className={s.header}>
          <div className={s.breadcrumb}>
            <Link href={`/ask?course=${session.course_id}`} className={s.breadcrumbLink}>
              ← {session.course_code}
            </Link>
          </div>

          <div className={s.examMeta}>
            <p className={s.examEyebrow}>{session.course_code} · Practice Exam</p>
            <h1 className={s.examTitle}>{session.exam_title}</h1>
            <p className={s.examDesc}>{session.exam_description}</p>

            <div className={s.examStats}>
              <span className={s.examStat}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                ~{session.total_estimated_minutes} min
              </span>
              <span className={s.examStat}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                {session.questions.length} questions · {totalMarks} marks
              </span>
            </div>
          </div>

          {/* Results summary bar */}
          {phase === 'results' && (
            <div className={s.resultsBanner}>
              <ScoreRing score={score} total={totalMarks} />
              <div className={s.resultsBannerText}>
                <p className={s.resultsPct}>{pct}%</p>
                <p className={s.resultsLabel}>{resultLabel}</p>
                <p className={s.resultsBreakdown}>
                  {score} of {totalMarks} marks ·{' '}
                  {Object.values(grading).filter(g => g.correct).length} of {session.questions.length} correct
                </p>
              </div>
              <Link
                href={`/ask?course=${session.course_id}`}
                className={s.chatWeakBtn}
              >
                Chat about weak areas →
              </Link>
            </div>
          )}
        </div>

        {/* ── Progress bar (taking only) ── */}
        {phase === 'taking' && (
          <div className={s.progressRow}>
            <div className={s.progressBar}>
              <div
                className={s.progressFill}
                style={{ width: `${session.questions.length > 0 ? (answeredCount / session.questions.length) * 100 : 0}%` }}
              />
            </div>
            <span className={s.progressLabel}>{answeredCount}/{session.questions.length} answered</span>
          </div>
        )}

        {/* ── Questions ── */}
        <div className={s.questions}>
          {session.questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              q={q}
              index={i}
              answer={answers[q.id] || ''}
              onChange={val => setAnswer(q.id, val)}
              grading={grading[q.id]}
              showResults={phase === 'results'}
            />
          ))}
        </div>

        {/* ── Submit / Done footer ── */}
        {phase === 'taking' && (
          <div className={s.footer}>
            {answeredCount < session.questions.length && (
              <p className={s.footerWarning}>
                {session.questions.length - answeredCount} question{session.questions.length - answeredCount !== 1 ? 's' : ''} unanswered — you can still submit
              </p>
            )}
            <button
              className={s.submitBtn}
              onClick={handleSubmit}
              disabled={answeredCount === 0}
            >
              Submit exam
            </button>
          </div>
        )}

        {phase === 'results' && (
          <div className={s.footer}>
            <Link href={`/ask?course=${session.course_id}`} className={s.submitBtn}>
              Chat about this material →
            </Link>
          </div>
        )}

      </div>
    </div>
  )
}

export default function PracticePage() {
  return (
    <Suspense>
      <PracticePageInner />
    </Suspense>
  )
}
