'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getCourseColor } from '@/lib/courseColors'
import { filterActiveCourses } from '@/lib/coursePrefs'
import s from './page.module.css'

type Course = {
  id: number
  name: string
  code: string
  canAccess: boolean
  isActive?: boolean
}

type Deadline = {
  title: string
  endDate: string
  courseId: number
  courseCode: string
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function CoursePage() {
  const { id } = useParams()
  const router  = useRouter()
  const orgUnitId = parseInt(id as string)

  const [course,        setCourse]        = useState<Course | null>(null)
  const [deadlines,     setDeadlines]     = useState<Deadline[]>([])
  const [loading,       setLoading]       = useState(true)

  const [examLoading,   setExamLoading]   = useState(false)
  const [recallLoading, setRecallLoading] = useState(false)
  const [actionError,   setActionError]   = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/courses').then(r => r.json()),
      fetch('/api/deadlines').then(r => r.json()),
    ]).then(([courses, dl]) => {
      const list = filterActiveCourses(Array.isArray(courses) ? courses : [])
      const found = list.find((c: Course) => c.id === orgUnitId)
      if (found) setCourse(found)

      const courseDl = (Array.isArray(dl) ? dl : []).filter(
        (d: Deadline) => d.courseId === orgUnitId
      )
      setDeadlines(courseDl)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [orgUnitId])

  const colorIdx = 0
  const color    = getCourseColor(colorIdx)

  const startPracticeExam = async () => {
    if (!course) return
    setExamLoading(true)
    setActionError(null)
    try {
      const res = await fetch('/api/practice-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId:   course.id,
          courseCode: course.code,
          courseName: course.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      router.push(`/practice/${data.sessionId}`)
    } catch (err: any) {
      setActionError(err.message || 'Failed to generate practice exam')
      setExamLoading(false)
    }
  }

  const startRecall = async () => {
    if (!course) return
    setRecallLoading(true)
    setActionError(null)
    try {
      const res = await fetch('/api/recall-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId:   course.id,
          courseCode: course.code,
          courseName: course.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      router.push(`/recall/${data.sessionId}`)
    } catch (err: any) {
      setActionError(err.message || 'Failed to generate recall set')
      setRecallLoading(false)
    }
  }

  if (loading) {
    return (
      <div className={s.center}>
        <div className={s.spinner} />
      </div>
    )
  }

  return (
    <div className={s.wrap}>
      <div className={s.inner}>

        {/* Breadcrumb */}
        <div className={s.breadcrumb}>
          <Link href="/courses" className={s.breadcrumbLink}>← Courses</Link>
        </div>

        {/* Header */}
        <div className={s.header}>
          <p className={s.eyebrow}>{course?.code || '—'}</p>
          <h1 className={s.title}>{course?.name || 'Course'}</h1>
        </div>

        {/* Action buttons */}
        <div className={s.actions}>
          <button
            className={`${s.actionBtn} ${s.actionBtnPrimary}`}
            onClick={startPracticeExam}
            disabled={examLoading || recallLoading || !course}
          >
            {examLoading ? (
              <>
                <span className={s.btnSpinner} />
                Generating exam…
              </>
            ) : 'Practice exam'}
          </button>

          <button
            className={`${s.actionBtn} ${s.actionBtnSecondary}`}
            onClick={startRecall}
            disabled={examLoading || recallLoading || !course}
          >
            {recallLoading ? (
              <>
                <span className={s.btnSpinner} />
                Generating…
              </>
            ) : 'Active recall'}
          </button>

          <Link
            href={`/ask?course=${orgUnitId}`}
            className={`${s.actionBtn} ${s.actionBtnSecondary}`}
          >
            Ask questions
          </Link>
        </div>

        {actionError && (
          <p className={s.actionError}>{actionError}</p>
        )}

        {/* Generation notice */}
        {(examLoading || recallLoading) && (
          <div className={s.generatingBanner}>
            <div className={s.spinner} />
            <div>
              <p className={s.generatingTitle}>
                {examLoading ? 'Building your practice exam…' : 'Generating recall cards…'}
              </p>
              <p className={s.generatingDesc}>
                Reading through your course materials — this takes about 30 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Upcoming deadlines */}
        <section className={s.section}>
          <p className={s.sectionLabel}>Upcoming</p>
          {deadlines.length === 0 ? (
            <p className={s.empty}>No upcoming deadlines</p>
          ) : (
            <div className={s.deadlineList}>
              {deadlines.slice(0, 8).map((d, i) => {
                const days = daysUntil(d.endDate)
                return (
                  <div key={i} className={s.deadlineRow}>
                    <div className={s.deadlineLeft}>
                      <p className={s.deadlineTitle}>{d.title}</p>
                      <p className={s.deadlineDate}>
                        {new Date(d.endDate).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric'
                        })}
                      </p>
                    </div>
                    <span
                      className={s.deadlineDays}
                      style={{
                        color: days <= 3 ? '#D45050' : days <= 7 ? '#C07030' : 'var(--ink-ghost)',
                      }}
                    >
                      {days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
