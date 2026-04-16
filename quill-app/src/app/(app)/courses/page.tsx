'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getCourseColor } from '@/lib/courseColors'
import { getShortenedNames } from '@/lib/shortenCourseName'
import { filterActiveCourses } from '@/lib/coursePrefs'
import { useUser } from '@/lib/userContext'
import s from './page.module.css'

type Course   = { id: number; name: string; code: string; canAccess: boolean }
type Deadline = { title: string; endDate: string; courseId: number }

const SAMPLE_COURSES: Course[] = [
  { id: 1, code: 'MECH 241', name: 'Fluid Mechanics 1',   canAccess: true },
  { id: 2, code: 'MECH 210', name: 'Mechanics of Solids', canAccess: true },
  { id: 3, code: 'MECH 228', name: 'Dynamics',            canAccess: true },
  { id: 4, code: 'MECH 203', name: 'Thermodynamics',      canAccess: true },
  { id: 5, code: 'APSC 200', name: 'Engineering Design',  canAccess: true },
  { id: 6, code: 'MECH 273', name: 'Numerical Methods',   canAccess: true },
]

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function nextLabel(deadline: Deadline | undefined) {
  if (!deadline) return 'No upcoming deadlines'
  const days = daysUntil(deadline.endDate)
  if (days <= 0) return `Due today — ${deadline.title}`
  if (days === 1) return `Tomorrow — ${deadline.title}`
  return `${days}d — ${deadline.title}`
}

export default function CoursesPage() {
  const { name, initials } = useUser()
  const [courses,    setCourses]    = useState<Course[]>([])
  const [deadlines,  setDeadlines]  = useState<Deadline[]>([])
  const [loading,    setLoading]    = useState(true)
  const [shortNames, setShortNames] = useState<Record<string, string>>({})
  const [search,     setSearch]     = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/courses').then(r => r.json()),
      fetch('/api/deadlines').then(r => r.json()),
    ]).then(([c, d]) => {
      const raw = Array.isArray(c) && c.length ? c : SAMPLE_COURSES
      setCourses(filterActiveCourses(raw))
      setDeadlines(d)
      setLoading(false)
    }).catch(() => { setCourses(filterActiveCourses(SAMPLE_COURSES)); setLoading(false) })
  }, [])

  const accessible = courses.filter(c => c.canAccess).filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
  })

  useEffect(() => {
    if (loading || accessible.length === 0) return
    getShortenedNames(accessible.map(c => c.name)).then(setShortNames)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // first upcoming deadline per course
  const nextByCourse = (courseId: number) =>
    deadlines.find(d => d.courseId === courseId)

  // upcoming across all courses for right panel
  const upcoming = deadlines.slice(0, 3)

  return (
    <div className={s.wrap}>

      {/* Main column */}
      <div className={s.main}>
        <div className={s.header}>
          <div>
            <p className={s.eyebrow}>Winter 2026 · {accessible.length} course{accessible.length !== 1 ? 's' : ''}</p>
            <h1 className={s.title}>Your <em>courses.</em></h1>
          </div>
          <div className={s.searchBar}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              style={{ border: 'none', background: 'transparent', outline: 'none', fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--ink)', width: '100%' }}
              placeholder="Search courses…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className={s.list}>
          {loading && (
            <p style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-ghost)' }}>Loading…</p>
          )}
          {accessible.map((course, i) => {
            const color = getCourseColor(i)
            const next  = nextByCourse(course.id)
            return (
              <Link key={course.id} href={`/ask?course=${course.id}`} className={s.row}>
                <div className={s.colorBar} style={{ background: color.accent }} />
                <div className={s.rowBody}>
                  <span className={s.code}>{course.code}</span>
                  <span className={s.name}>{shortNames[course.name] ?? course.name}</span>
                  <div className={s.progressWrap}>
                    <p className={s.progressLabel}>Prep · —</p>
                    <div className={s.progressBar}>
                      <div className={s.progressFill} style={{ width: '0%', background: color.accent }} />
                    </div>
                  </div>
                  <span className={s.next}>{nextLabel(next)}</span>
                  <span className={s.action}>Study →</span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Right panel */}
      <div className={s.rightPanel}>
        <div className={s.userCard}>
          <div className={s.userAvatar}>{initials}</div>
          <p className={s.userName}>{name}</p>
          <p className={s.userSchool}>Queen's University</p>
        </div>

        <div>
          <p className={s.panelLabel}>Upcoming</p>
          <div className={s.upcomingList}>
            {upcoming.length === 0 && !loading && (
              <p style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--ink-ghost)' }}>Nothing coming up.</p>
            )}
            {upcoming.map((d, i) => {
              const days  = daysUntil(d.endDate)
              const color = days <= 3 ? '#D45050' : days <= 7 ? '#C97C2A' : '#9AB0D0'
              return (
                <div key={i} className={s.upItem}>
                  <div className={s.upDot} style={{ background: color }} />
                  <div>
                    <p className={s.upTitle}>{d.title}</p>
                    <p className={s.upSub}>{days <= 0 ? 'Due today' : days === 1 ? 'Tomorrow' : `${days}d away`}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <Link href="/ask" className={s.chatPreview}>
          <div className={s.cpTop}>
            <div className={s.cpDot} />
            <span className={s.cpLabel}>Ask Quill</span>
          </div>
          <p className={s.cpMsg}>Ask anything about your courses, deadlines, or get a practice set.</p>
          <p className={s.cpCta}>Start a chat →</p>
        </Link>
      </div>

    </div>
  )
}
