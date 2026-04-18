'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { RecallCard } from '@/app/api/recall-set/route'
import s from './page.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionData = {
  id: string
  course_id: string
  course_code: string
  course_name: string | null
  week_num: number | null
  cards: RecallCard[]
  results: Record<string, 'pass' | 'fail'> | null
  score: number | null
  completed_at: string | null
}

type Phase = 'loading' | 'studying' | 'submitting' | 'results'

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

// ── Flip card ─────────────────────────────────────────────────────────────────

function FlipCard({
  card,
  flipped,
  onFlip,
}: {
  card: RecallCard
  flipped: boolean
  onFlip: () => void
}) {
  return (
    <div
      className={`${s.cardScene}`}
      onClick={!flipped ? onFlip : undefined}
      aria-label={flipped ? 'Answer side' : 'Click to reveal answer'}
    >
      <div className={`${s.card} ${flipped ? s.cardFlipped : ''}`}>
        {/* Front — question */}
        <div className={s.cardFace} aria-hidden={flipped}>
          <div className={s.cardFaceInner}>
            <span className={s.cardSideLabel}>Question</span>
            <MD className={s.cardText}>{card.question}</MD>
            {card.sourceHint && (
              <span className={s.cardHint}>{card.sourceHint}</span>
            )}
            <button className={s.revealBtn} onClick={onFlip} tabIndex={flipped ? -1 : 0}>
              Reveal answer
            </button>
          </div>
        </div>

        {/* Back — answer */}
        <div className={`${s.cardFace} ${s.cardBack}`} aria-hidden={!flipped}>
          <div className={s.cardFaceInner}>
            <span className={s.cardSideLabel}>Answer</span>
            <MD className={s.cardText}>{card.answer}</MD>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function RecallPageInner() {
  const params    = useParams()
  const router    = useRouter()
  const sessionId = params.id as string

  const [phase,     setPhase]     = useState<Phase>('loading')
  const [session,   setSession]   = useState<SessionData | null>(null)
  const [index,     setIndex]     = useState(0)
  const [flipped,   setFlipped]   = useState(false)
  const [results,   setResults]   = useState<Record<string, 'pass' | 'fail'>>({})
  const [score,     setScore]     = useState(0)
  const [error,     setError]     = useState<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  // Load session
  useEffect(() => {
    fetch(`/api/recall-set/${sessionId}`)
      .then(r => r.json())
      .then((data: SessionData) => {
        if ((data as any).error) { setError((data as any).error); return }
        setSession(data)
        // Resume completed session
        if (data.completed_at && data.results) {
          setResults(data.results)
          setScore(data.score || 0)
          setPhase('results')
        } else {
          setPhase('studying')
        }
      })
      .catch(() => setError('Could not load this recall session.'))
  }, [sessionId])

  const cards = session?.cards || []
  const currentCard = cards[index]
  const isLastCard  = index === cards.length - 1

  const handleFlip = () => setFlipped(true)

  const handleResult = async (verdict: 'pass' | 'fail') => {
    if (!currentCard) return

    const newResults = { ...results, [currentCard.id]: verdict }
    setResults(newResults)
    setFlipped(false)

    if (isLastCard) {
      // Submit
      setPhase('submitting')
      topRef.current?.scrollIntoView({ behavior: 'smooth' })
      try {
        const res = await fetch(`/api/recall-set/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ results: newResults }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to save')
        setScore(data.score)
        setPhase('results')
      } catch (err: any) {
        setError(err.message || 'Failed to save results')
        setPhase('studying')
      }
    } else {
      setIndex(i => i + 1)
    }
  }

  const pct = cards.length > 0 ? Math.round((score / cards.length) * 100) : 0
  const passed = Object.values(results).filter(v => v === 'pass').length
  const failed = Object.values(results).filter(v => v === 'fail').length

  // ── States ─────────────────────────────────────────────────────────────────
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
        <p className={s.loadingLabel}>Loading cards…</p>
      </div>
    )
  }

  if (phase === 'submitting') {
    return (
      <div className={s.center}>
        <div className={s.spinner} />
        <p className={s.loadingLabel}>Saving results…</p>
      </div>
    )
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  if (phase === 'results') {
    return (
      <div className={s.wrap} ref={topRef}>
        <div className={s.inner}>
          <div className={s.breadcrumb}>
            <Link href={`/ask?course=${session.course_id}`} className={s.breadcrumbLink}>
              ← {session.course_code}
            </Link>
          </div>

          <div className={s.resultsPage}>
            <div className={s.resultsHeader}>
              <p className={s.resultsEyebrow}>
                {session.course_code}
                {session.week_num ? ` · Week ${session.week_num}` : ''} · Active Recall
              </p>
              <h1 className={s.resultsTitle}>Session complete</h1>
            </div>

            <div className={s.resultsSummary}>
              <div className={s.summaryBig}>
                <span className={s.summaryScore} style={{
                  color: pct >= 80 ? '#2B7A4B' : pct >= 60 ? '#C07030' : '#D45050'
                }}>
                  {pct}%
                </span>
                <span className={s.summaryLabel}>
                  {pct >= 80 ? 'Strong recall' : pct >= 60 ? 'Getting there' : 'Needs more review'}
                </span>
              </div>
              <div className={s.summaryBreakdown}>
                <span className={s.summaryPill} style={{ color: '#2B7A4B', background: 'rgba(43,122,75,0.08)' }}>
                  {passed} known
                </span>
                <span className={s.summaryPill} style={{ color: '#D45050', background: 'rgba(212,80,80,0.08)' }}>
                  {failed} missed
                </span>
              </div>
            </div>

            {/* Card-by-card review */}
            <div className={s.reviewList}>
              {cards.map((card, i) => {
                const verdict = results[card.id]
                return (
                  <div
                    key={card.id}
                    className={`${s.reviewRow} ${verdict === 'pass' ? s.reviewRowPass : s.reviewRowFail}`}
                  >
                    <div className={s.reviewVerdict}>
                      {verdict === 'pass'
                        ? <span className={s.verdictPass}>✓</span>
                        : <span className={s.verdictFail}>✗</span>
                      }
                    </div>
                    <div className={s.reviewContent}>
                      <span className={s.reviewNum}>{i + 1}</span>
                      <div>
                        <MD className={s.reviewQuestion}>{card.question}</MD>
                        <MD className={s.reviewAnswer}>{card.answer}</MD>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className={s.resultsFooter}>
              <Link href={`/ask?course=${session.course_id}`} className={s.doneBtn}>
                Chat about this material →
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Studying ─────────────────────────────────────────────────────────────────
  return (
    <div className={s.wrap} ref={topRef}>
      <div className={s.inner}>

        {/* Header */}
        <div className={s.header}>
          <div className={s.breadcrumb}>
            <Link href={`/ask?course=${session.course_id}`} className={s.breadcrumbLink}>
              ← {session.course_code}
            </Link>
          </div>
          <div className={s.headerMeta}>
            <p className={s.eyebrow}>
              {session.course_code}
              {session.week_num ? ` · Week ${session.week_num}` : ''} · Active Recall
            </p>
            <h1 className={s.title}>
              {session.week_num ? `Week ${session.week_num} review` : 'Recall session'}
            </h1>
          </div>
        </div>

        {/* Progress */}
        <div className={s.progressRow}>
          <div className={s.progressBar}>
            <div
              className={s.progressFill}
              style={{ width: `${((index) / cards.length) * 100}%` }}
            />
          </div>
          <span className={s.progressLabel}>{index + 1} / {cards.length}</span>
        </div>

        {/* Topic label */}
        <p className={s.topicLabel}>{currentCard.topic}</p>

        {/* Flip card */}
        <FlipCard
          card={currentCard}
          flipped={flipped}
          onFlip={handleFlip}
        />

        {/* Pass / Fail buttons (only when flipped) */}
        <div className={`${s.judgement} ${flipped ? s.judgementVisible : ''}`}>
          <p className={s.judgementHint}>How well did you know this?</p>
          <div className={s.judgementBtns}>
            <button
              className={`${s.verdictBtn} ${s.verdictBtnFail}`}
              onClick={() => handleResult('fail')}
              tabIndex={flipped ? 0 : -1}
            >
              Missed it
            </button>
            <button
              className={`${s.verdictBtn} ${s.verdictBtnPass}`}
              onClick={() => handleResult('pass')}
              tabIndex={flipped ? 0 : -1}
            >
              Got it
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function RecallPage() {
  return (
    <Suspense>
      <RecallPageInner />
    </Suspense>
  )
}
