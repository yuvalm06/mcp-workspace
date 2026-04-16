'use client'
import { useEffect, useState } from 'react'
import { getCourses, getGrades, getDeadlines, getCourseContent, Course, Grade, CalendarEvent, Module } from '@/lib/mcp'
import { getCourseColor } from '@/lib/courseColors'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function CoursePage() {
  const { id } = useParams()
  const router = useRouter()
  const orgUnitId = parseInt(id as string)
  const [course, setCourse] = useState<Course | null>(null)
  const [grades, setGrades] = useState<Grade[]>([])
  const [deadlines, setDeadlines] = useState<CalendarEvent[]>([])
  const [content, setContent] = useState<Module[]>([])
  const [tab, setTab] = useState<'overview' | 'content' | 'grades'>('overview')
  const [examLoading, setExamLoading] = useState(false)
  const [exam, setExam] = useState<string | null>(null)

  useEffect(() => {
    getCourses().then(courses => {
      const c = courses.find(x => x.id === orgUnitId)
      if (c) setCourse(c)
    })
    getGrades(orgUnitId).then(setGrades).catch(() => {})
    getDeadlines(orgUnitId).then(setDeadlines).catch(() => {})
    getCourseContent(orgUnitId).then(setContent).catch(() => {})
  }, [orgUnitId])

  const color = getCourseColor(0)

  const generateExam = async () => {
    setExamLoading(true)
    setTab('overview')
    try {
      const res = await fetch('/api/exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgUnitId, modules: content }),
      })
      const data = await res.json()
      setExam(data.exam)
    } catch {
      setExam('Failed to generate exam. Make sure the MCP server is running.')
    }
    setExamLoading(false)
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900 }}>
      {/* Breadcrumb */}
      <Link href="/courses" style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#9A9284', textDecoration: 'none', letterSpacing: '0.04em' }}>
        ← Courses
      </Link>

      {/* Header */}
      <div style={{ marginTop: 16, marginBottom: 24 }}>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#C4BDB0', letterSpacing: '0.07em', marginBottom: 6 }}>
          {course?.code}
        </p>
        <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 34, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          {course?.name || 'Loading…'}
        </h1>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
        <button onClick={generateExam} disabled={examLoading || content.length === 0} style={{
          fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 400,
          padding: '8px 18px', borderRadius: 100, background: '#1A1714', color: '#fff',
          border: 'none', cursor: examLoading ? 'wait' : 'pointer', opacity: content.length === 0 ? 0.5 : 1,
        }}>
          {examLoading ? 'Generating…' : '✦ Practice exam'}
        </button>
        <button style={{
          fontFamily: 'DM Sans, sans-serif', fontSize: 13, padding: '8px 18px', borderRadius: 100,
          background: 'transparent', border: '0.5px solid rgba(154,146,132,0.35)', color: '#9A9284', cursor: 'pointer',
        }}>Active recall</button>
        <button style={{
          fontFamily: 'DM Sans, sans-serif', fontSize: 13, padding: '8px 18px', borderRadius: 100,
          background: 'transparent', border: '0.5px solid rgba(154,146,132,0.35)', color: '#9A9284', cursor: 'pointer',
        }}>Grade forecast</button>
      </div>

      {/* Exam output */}
      {exam && (
        <div style={{
          background: '#fff', borderRadius: 14, padding: '20px 24px', marginBottom: 24,
          boxShadow: '0 1px 4px rgba(24,22,15,0.06), inset 0 0 0 0.5px rgba(0,0,0,0.045)',
        }}>
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9A9284', marginBottom: 16 }}>
            ✦ Practice exam — generated from your lecture slides
          </p>
          <pre style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
            {exam}
          </pre>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid rgba(154,146,132,0.25)', marginBottom: 20 }}>
        {(['overview', 'content', 'grades'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, padding: '8px 16px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t ? '#1A1714' : '#9A9284',
            borderBottom: tab === t ? '1.5px solid #1A1714' : '1.5px solid transparent',
            marginBottom: -0.5, textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', gap: 16 }}>
          {/* Deadlines */}
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#C4BDB0', marginBottom: 10 }}>Upcoming</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deadlines.slice(0, 5).map((d, i) => (
                <div key={i} style={{ padding: '10px 14px', background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(24,22,15,0.06), inset 0 0 0 0.5px rgba(0,0,0,0.04)' }}>
                  <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714' }}>{d.title}</p>
                  <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9A9284', marginTop: 3 }}>
                    {new Date(d.endDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                </div>
              ))}
              {deadlines.length === 0 && <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#C4BDB0' }}>No upcoming deadlines</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'grades' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grades.map((g, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', padding: '12px 16px', background: '#fff', borderRadius: 10,
              boxShadow: '0 1px 4px rgba(24,22,15,0.06), inset 0 0 0 0.5px rgba(0,0,0,0.04)',
            }}>
              <span style={{ flex: 1, fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714' }}>{g.name}</span>
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, fontWeight: 300, color: '#1A1714' }}>
                {g.percentage || (g.points != null && g.maxPoints ? `${Math.round((g.points/g.maxPoints)*100)}%` : '—')}
              </span>
            </div>
          ))}
          {grades.length === 0 && <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#C4BDB0' }}>No grades available</p>}
        </div>
      )}

      {tab === 'content' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {content.map((mod) => (
            <div key={mod.id} style={{ padding: '12px 16px', background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(24,22,15,0.06), inset 0 0 0 0.5px rgba(0,0,0,0.04)' }}>
              <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 400, color: '#1A1714' }}>{mod.title}</p>
              {mod.modules?.map(sub => (
                <p key={sub.id} style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: '#9A9284', marginTop: 4, paddingLeft: 12 }}>
                  {sub.title} {sub.topics ? `· ${sub.topics.length} files` : ''}
                </p>
              ))}
            </div>
          ))}
          {content.length === 0 && <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#C4BDB0' }}>Loading content…</p>}
        </div>
      )}
    </div>
  )
}
