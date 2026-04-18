'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import s from './page.module.css'

type Course = { id: number; name: string; code: string }

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)

  // Step 1 — connection polling
  const [connected, setConnected] = useState(false)

  // Step 2 — courses + exam form
  const [courses, setCourses] = useState<Course[]>([])
  const [addedExams, setAddedExams] = useState<{ code: string; title: string; label: string }[]>([])
  const [examCourseId, setExamCourseId] = useState(0)
  const [examTitle, setExamTitle] = useState('Final Exam')
  const [examDate, setExamDate] = useState('')
  const [examTime, setExamTime] = useState('09:00')
  const [saving, setSaving] = useState(false)

  // Poll for D2L connection on step 1
  useEffect(() => {
    if (step !== 1) return
    let active = true
    const poll = async () => {
      try {
        const res = await fetch('/api/onboarding/status')
        const data = await res.json()
        if (data.connected && active) {
          setConnected(true)
          const cr = await fetch('/api/courses')
          const cd = await cr.json()
          if (Array.isArray(cd) && cd.length > 0) {
            setCourses(cd)
            setExamCourseId(cd[0].id)
          }
        }
      } catch { /* ignore */ }
    }
    poll()
    const interval = setInterval(poll, 4000)
    return () => { active = false; clearInterval(interval) }
  }, [step])

  // Fetch courses when entering step 2 if not already loaded
  useEffect(() => {
    if (step !== 2 || courses.length > 0) return
    fetch('/api/courses')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d) && d.length > 0) {
          setCourses(d)
          setExamCourseId(d[0].id)
        }
      })
      .catch(() => {})
  }, [step, courses.length])

  const addExam = async () => {
    if (!examDate || !examCourseId) return
    setSaving(true)
    const course = courses.find(c => c.id === examCourseId)
    const exam_date = new Date(`${examDate}T${examTime}:00`).toISOString()
    try {
      await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: examCourseId,
          course_name: course?.name || '',
          title: examTitle,
          exam_date,
        }),
      })
      setAddedExams(prev => [
        ...prev,
        {
          code: course?.code || '',
          title: examTitle,
          label: new Date(exam_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        },
      ])
      setExamDate('')
      setExamTitle('Final Exam')
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <div className={s.page}>
      <div className={s.stars} aria-hidden="true" />
      <div className={s.glow} aria-hidden="true" />

      <div className={s.shell}>
        {/* Progress dots */}
        <div className={s.progress}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className={`${s.dot} ${i === step ? s.dotActive : ''} ${i < step ? s.dotDone : ''}`}
            />
          ))}
        </div>

        <div className={s.card}>

          {/* ── Step 0: Install Extension ── */}
          {step === 0 && (
            <>
              <div className={s.iconWrap} aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <p className={s.stepLabel}>Step 1 of 3</p>
              <h1 className={s.heading}>Install the Quill extension</h1>
              <p className={s.desc}>
                The Chrome extension connects Quill to your OnQ account.
                It reads your session cookies — Quill never sees your password.
              </p>
              <a
                href="https://chromewebstore.google.com"
                target="_blank"
                rel="noreferrer"
                className={s.primaryBtn}
              >
                Install for Chrome
              </a>
              <button className={s.skipBtn} onClick={() => setStep(1)}>
                I already have it
              </button>
            </>
          )}

          {/* ── Step 1: Connect OnQ (waiting) ── */}
          {step === 1 && !connected && (
            <>
              <div className={s.pulseWrap} aria-hidden="true">
                <div className={s.pulseRing} />
                <div className={s.pulseDot} />
              </div>
              <p className={s.stepLabel}>Step 2 of 3</p>
              <h1 className={s.heading}>Connect to OnQ</h1>
              <p className={s.desc}>
                Open{' '}
                <a
                  href="https://onq.queensu.ca"
                  target="_blank"
                  rel="noreferrer"
                  className={s.link}
                >
                  onq.queensu.ca
                </a>{' '}
                in a new tab while logged in.
                The extension will sync your courses automatically.
              </p>
              <p className={s.waiting}>Waiting for connection&hellip;</p>
              <button className={s.skipBtn} onClick={() => setStep(2)}>
                Skip for now
              </button>
            </>
          )}

          {/* ── Step 1: Connected ── */}
          {step === 1 && connected && (
            <>
              <div className={s.checkWrap} aria-hidden="true">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h1 className={s.heading}>Connected to OnQ</h1>
              <p className={s.desc}>
                {courses.length} course{courses.length !== 1 ? 's' : ''} synced from your account.
              </p>
              <button className={s.primaryBtn} onClick={() => setStep(2)}>
                Continue
              </button>
            </>
          )}

          {/* ── Step 2: Add Exams ── */}
          {step === 2 && (
            <>
              <p className={s.stepLabel}>Step 3 of 3</p>
              <h1 className={s.heading}>When are your exams?</h1>
              <p className={s.desc}>
                OnQ usually doesn&rsquo;t list exam dates.
                Add them here so Quill can prepare you.
              </p>

              {/* Added exams */}
              {addedExams.length > 0 && (
                <div className={s.examList}>
                  {addedExams.map((e, i) => (
                    <div key={i} className={s.examRow}>
                      <span className={s.examCode}>{e.code}</span>
                      <span className={s.examName}>{e.title}</span>
                      <span className={s.examDate}>{e.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Exam form */}
              {courses.length > 0 ? (
                <div className={s.examForm}>
                  <div className={s.formRow}>
                    <div className={s.field}>
                      <label className={s.label}>Course</label>
                      <select
                        value={examCourseId}
                        onChange={e => setExamCourseId(Number(e.target.value))}
                        className={s.select}
                      >
                        {courses.map(c => (
                          <option key={c.id} value={c.id}>{c.code}</option>
                        ))}
                      </select>
                    </div>
                    <div className={s.field}>
                      <label className={s.label}>Type</label>
                      <select
                        value={examTitle}
                        onChange={e => setExamTitle(e.target.value)}
                        className={s.select}
                      >
                        <option>Final Exam</option>
                        <option>Midterm Exam</option>
                        <option>Quiz</option>
                        <option>Lab Exam</option>
                      </select>
                    </div>
                  </div>
                  <div className={s.formRow}>
                    <div className={s.field}>
                      <label className={s.label}>Date</label>
                      <input
                        type="date"
                        value={examDate}
                        onChange={e => setExamDate(e.target.value)}
                        className={s.input}
                      />
                    </div>
                    <div className={s.fieldSmall}>
                      <label className={s.label}>Time</label>
                      <input
                        type="time"
                        value={examTime}
                        onChange={e => setExamTime(e.target.value)}
                        className={s.input}
                      />
                    </div>
                    <button
                      className={s.addBtn}
                      onClick={addExam}
                      disabled={!examDate || saving}
                    >
                      {saving ? '...' : 'Add'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className={s.noCourses}>
                  Connect to OnQ first to add exams by course, or add them later from the dashboard.
                </p>
              )}

              <button className={s.primaryBtn} onClick={() => router.push('/')}>
                {addedExams.length > 0 ? 'Done \u2014 go to dashboard' : 'Skip \u2014 go to dashboard'}
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
