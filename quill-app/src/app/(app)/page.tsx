'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getCourseColor, getHour } from '@/lib/courseColors'
import { getShortenedNames } from '@/lib/shortenCourseName'
import { filterActiveCourses } from '@/lib/coursePrefs'
import { useUser } from '@/lib/userContext'
import s from './page.module.css'

type Course   = { id: number; name: string; code: string; canAccess: boolean; isManual?: boolean; colorIdx?: number }
type Exam     = { id: number; title: string; courseCode: string; date: string }
type Deadline = { title: string; endDate: string; courseId: number }

type FeedItem = {
  type: string
  colorIdx: number
  code: string
  title: string
  sub: string
  action: string
  courseId: number
}


function buildFeedItems(exams: Exam[], deadlines: Deadline[], courses: Course[]): FeedItem[] {
  const items: FeedItem[] = []
  const now = Date.now()
  const MS = 1000 * 60 * 60 * 24

  for (const exam of [...exams].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())) {
    if (items.length >= 3) break
    const days = Math.ceil((new Date(exam.date).getTime() - now) / MS)
    if (days < 0) continue
    const idx = courses.findIndex(c => c.code === exam.courseCode)
    items.push({
      type:    'EXAM',
      colorIdx: Math.max(0, idx),
      code:    exam.courseCode,
      title:   exam.title,
      sub:     days === 0 ? 'Today — review key concepts' : `${days} day${days !== 1 ? 's' : ''} away — start your prep`,
      action:  'Prepare →',
      courseId: idx >= 0 ? courses[idx].id : 1,
    })
  }

  for (const dl of deadlines) {
    if (items.length >= 3) break
    const days = Math.ceil((new Date(dl.endDate).getTime() - now) / MS)
    if (days < 0 || days > 7) continue
    const course = courses.find(c => c.id === dl.courseId)
    if (!course) continue
    const idx = courses.findIndex(c => c.id === dl.courseId)
    items.push({
      type:    'DEADLINE',
      colorIdx: Math.max(0, idx),
      code:    course.code,
      title:   dl.title,
      sub:     days === 0 ? 'Due today' : `Due in ${days} day${days !== 1 ? 's' : ''}`,
      action:  'Review →',
      courseId: course.id,
    })
  }

  return items
}

// ── Dynamic greeting sub-line ─────────────────────────────────────────────────

function getSubline(exams: Exam[], deadlines: Deadline[], weekNum: number): string {
  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const now = Date.now()

  const urgentExam = exams
    .map(e => ({ ...e, days: Math.ceil((new Date(e.date).getTime() - now) / MS_PER_DAY) }))
    .filter(e => e.days >= 0 && e.days <= 7)
    .sort((a, b) => a.days - b.days)[0]

  if (urgentExam) {
    if (urgentExam.days === 0) return `Week ${weekNum} · ${urgentExam.courseCode} exam is today`
    return `Week ${weekNum} · ${urgentExam.courseCode} exam in ${urgentExam.days} day${urgentExam.days !== 1 ? 's' : ''}`
  }

  const urgentDeadline = deadlines
    .map(d => ({ ...d, days: Math.ceil((new Date(d.endDate).getTime() - now) / MS_PER_DAY) }))
    .filter(d => d.days >= 0 && d.days <= 3)
    .sort((a, b) => a.days - b.days)[0]

  if (urgentDeadline) {
    return `Week ${weekNum} · ${urgentDeadline.title} due in ${urgentDeadline.days} day${urgentDeadline.days !== 1 ? 's' : ''}`
  }

  return `Week ${weekNum} · You're on track.`
}


// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ exams, threadCount, courseCount }: { exams: Exam[]; threadCount: number; courseCount: number }) {
  const { name, initials } = useUser()
  const upcoming = [...exams]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .filter(e => new Date(e.date).getTime() >= Date.now())
    .slice(0, 3)

  return (
    <aside className={s.sidebar}>

      {/* ── Profile ── */}
      <div className={s.sbProfile}>
        <div className={s.sbAvatar}>{initials}</div>
        <p className={s.sbName}>{name}</p>
        <p className={s.sbMeta}>Mechanical Eng. · Queen's</p>
        <div className={s.sbStats}>
          <div className={s.sbStat}>
            <span className={s.sbStatNum}>{threadCount}</span>
            <span className={s.sbStatLabel}>chats</span>
          </div>
          <div className={s.sbStat}>
            <span className={s.sbStatNum}>{courseCount}</span>
            <span className={s.sbStatLabel}>courses</span>
          </div>
        </div>
      </div>

      {/* ── Upcoming exams ── */}
      <div className={s.sbSection}>
        <p className={s.sbSectionLabel}>UPCOMING</p>
        {upcoming.length === 0 ? (
          <p className={s.sbEmpty}>
            No exams added yet
          </p>
        ) : upcoming.map((exam, i) => {
          const color = getCourseColor(i)
          const d     = new Date(exam.date)
          const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          return (
            <div key={exam.id} className={s.sbExamRow}>
              <div className={s.sbExamDot} style={{ background: color.accent }} />
              <div className={s.sbExamBody}>
                <p className={s.sbExamTitle}>{exam.title}</p>
                <p className={s.sbExamMeta}>{exam.courseCode} · {label}</p>
              </div>
            </div>
          )
        })}
      </div>

    </aside>
  )
}

// ── Add Course Modal ─────────────────────────────────────────────────────────

function AddCourseModal({ onSave, onClose }: {
  onSave: (c: { code: string; name: string; colorIdx: number }) => void
  onClose: () => void
}) {
  const [code,     setCode]     = useState('')
  const [name,     setName]     = useState('')
  const [colorIdx, setColorIdx] = useState(0)
  const [saving,   setSaving]   = useState(false)

  const swatches = Array.from({ length: 6 }, (_, i) => getCourseColor(i))

  const handleSave = async () => {
    if (!code.trim() || !name.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/manual-courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase(), name: name.trim(), colorIdx }),
      })
      const row = await res.json()
      onSave({ code: row.code ?? code.trim().toUpperCase(), name: row.name ?? name.trim(), colorIdx: row.color_idx ?? colorIdx })
    } catch {
      onSave({ code: code.trim().toUpperCase(), name: name.trim(), colorIdx })
    }
    setSaving(false)
  }

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <p className={s.modalEyebrow}>Add course</p>
        <h2 className={s.modalTitle}>New course</h2>

        <div className={s.modalFields}>
          <div className={s.modalField}>
            <label className={s.modalLabel}>Course code</label>
            <input
              className={s.modalInput}
              placeholder="e.g. MECH 340"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          <div className={s.modalField}>
            <label className={s.modalLabel}>Course name</label>
            <input
              className={s.modalInput}
              placeholder="e.g. Heat Transfer"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div className={s.modalField}>
            <label className={s.modalLabel}>Color</label>
            <div className={s.swatches}>
              {swatches.map((c, i) => (
                <button
                  key={i}
                  className={`${s.swatch} ${colorIdx === i ? s.swatchActive : ''}`}
                  style={{ background: c.accent }}
                  onClick={() => setColorIdx(i)}
                  aria-label={`Color ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </div>

        {(code || name) && (
          <div className={s.modalPreview}>
            <div className={s.modalPreviewTab} style={{ background: swatches[colorIdx].tab }} />
            <div className={s.modalPreviewBody} style={{ background: swatches[colorIdx].tint }}>
              <span className={s.folderCode}>{code.toUpperCase() || 'CODE'}</span>
              <span className={s.folderName}>{name || 'Course name'}</span>
            </div>
          </div>
        )}

        <div className={s.modalActions}>
          <button className={s.modalCancel} onClick={onClose}>Cancel</button>
          <button
            className={s.modalSave}
            onClick={handleSave}
            disabled={!code.trim() || !name.trim() || saving}
          >
            {saving ? 'Saving…' : 'Add course'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { name } = useUser()
  const [courses,      setCourses]      = useState<Course[]>([])
  const [manualExtra,  setManualExtra]  = useState<Course[]>([])
  const [loading,      setLoading]      = useState(true)
  const [onqConnected, setOnqConnected] = useState<boolean | null>(null)
  const [showAdd,      setShowAdd]      = useState(false)
  const [shortNames,  setShortNames]  = useState<Record<string, string>>({})
  const [exams,       setExams]       = useState<Exam[]>([])
  const [deadlines,   setDeadlines]   = useState<Deadline[]>([])
  const [subline,     setSubline]     = useState('')
  const [threadCount, setThreadCount] = useState(0)

  const today     = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const hour      = getHour()
  const weekStart = new Date(2026, 0, 6)
  const weekNum   = Math.ceil((Date.now() - weekStart.getTime()) / (7 * 24 * 60 * 60 * 1000))

  useEffect(() => {
    Promise.all([
      fetch('/api/courses').then(r => r.json()).catch(() => []),
      fetch('/api/manual-courses').then(r => r.json()).catch(() => []),
      fetch('/api/exams').then(r => r.json()).catch(() => []),
      fetch('/api/deadlines').then(r => r.json()).catch(() => []),
      fetch('/api/threads').then(r => r.json()).catch(() => []),
    ]).then(([pulled, manual, examData, deadlineData, threadData]) => {
      const raw  = Array.isArray(pulled) ? pulled : []
      const base = filterActiveCourses(raw)
      setOnqConnected(raw.length > 0)
      setCourses(base)
      const manualCourses: Course[] = (Array.isArray(manual) ? manual : []).map((m: any) => ({
        id:        m.id,
        code:      m.code,
        name:      m.name,
        canAccess: true,
        isManual:  true,
        colorIdx:  m.color_idx ?? 0,
      }))
      setManualExtra(manualCourses)
      const examList: Exam[] = Array.isArray(examData) ? examData : []
      const deadlineList: Deadline[] = Array.isArray(deadlineData) ? deadlineData : []
      setExams(examList)
      setDeadlines(deadlineList)
      setSubline(getSubline(examList, deadlineList, weekNum))
      setThreadCount(Array.isArray(threadData) ? threadData.length : 0)
      setLoading(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const allCourses = [...courses, ...manualExtra]

  useEffect(() => {
    if (loading || allCourses.length === 0) return
    getShortenedNames(allCourses.map(c => c.name)).then(setShortNames)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddSave = (c: { code: string; name: string; colorIdx: number }) => {
    const newCourse: Course = {
      id:        Date.now(),
      code:      c.code,
      name:      c.name,
      canAccess: true,
      isManual:  true,
      colorIdx:  c.colorIdx,
    }
    setManualExtra(prev => [...prev, newCourse])
    setShowAdd(false)
  }

  return (
    <main className={s.main}>
      <div className={s.content}>

        {/* Greeting */}
        <div>
          <p className={s.eyebrow}>{today}</p>
          <h1 className={s.headline}>Good {hour}, <em>{name || '…'}.</em></h1>
          {subline && <p className={s.subline}>{subline}</p>}
        </div>

        {/* My Courses */}
        <div>
          <div className={s.sectionHeader}>
            <span className={s.sectionLabel}>My Courses</span>
            <span className={s.sectionCount}>{allCourses.length}</span>
            <Link href="/courses/manage" className={s.manageLink}>Manage</Link>
          </div>
          <div className={s.coursesScroll}>
            {loading ? (
              <p style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-ghost)' }}>Loading…</p>
            ) : allCourses.length === 0 && onqConnected === false ? (
              <div className={s.connectPrompt}>
                <div className={s.connectPromptIcon}>Q</div>
                <p className={s.connectPromptTitle}>Connect your OnQ account</p>
                <p className={s.connectPromptDesc}>Install the Chrome extension and visit OnQ — your courses will appear here automatically.</p>
                <a
                  href="https://chromewebstore.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className={s.connectPromptBtn}
                >
                  Install Extension →
                </a>
              </div>
            ) : allCourses.map((course, i) => {
              const colorIdx = course.isManual && course.colorIdx !== undefined ? course.colorIdx : i
              const color    = getCourseColor(colorIdx)
              return (
                <Link key={course.id} href={`/ask?course=${course.id}`} className={s.folderWrap}>
                  <div className={s.folderTab} style={{ background: color.tab }} />
                  <div className={s.folderBody} style={{ background: color.tint }}>
                    <span className={s.folderCode}>{course.code}</span>
                    <span className={s.folderName}>{shortNames[course.name] ?? course.name}</span>
                    {course.isManual && <span className={s.manualBadge}>Manual</span>}
                    <span className={s.folderCta}>Chat with {course.code} →</span>
                  </div>
                </Link>
              )
            })}
            <div className={s.folderAdd} onClick={() => setShowAdd(true)}>
              <span className={s.folderAddLabel}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add course
              </span>
            </div>
          </div>
        </div>

        {/* From Quill feed */}
        {(() => {
          const feedItems = buildFeedItems(exams, deadlines, allCourses)
          if (loading || feedItems.length === 0) return null
          return (
            <div className={s.fromQuillSection}>
              <div className={s.sectionHeader}>
                <span className={s.sectionLabel}>Coming up</span>
              </div>
              <div className={s.feed}>
                {feedItems.map((item, i) => {
                  const color = getCourseColor(item.colorIdx)
                  return (
                    <div key={i} className={s.feedCard}>
                      <div className={s.feedBody}>
                        <div className={s.feedEyebrow}>
                          <span className={s.feedTypePill} style={{ background: color.tint, color: color.accent }}>
                            {item.type}
                          </span>
                          <span className={s.feedCode}>{item.code}</span>
                        </div>
                        <p className={s.feedTitle}>{item.title}</p>
                        <p className={s.feedSub}>{item.sub}</p>
                      </div>
                      <Link href={`/ask?course=${item.courseId}`} className={s.feedAction}>
                        {item.action}
                      </Link>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

      </div>

      <Sidebar exams={exams} threadCount={threadCount} courseCount={allCourses.length} />

      {showAdd && (
        <AddCourseModal onSave={handleAddSave} onClose={() => setShowAdd(false)} />
      )}
    </main>
  )
}
