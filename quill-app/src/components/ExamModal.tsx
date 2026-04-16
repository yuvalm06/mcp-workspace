'use client'
import { useState } from 'react'

type Course = { id: number; name: string; code: string }
type Exam = { id?: string; course_id: number; course_name: string; title: string; exam_date: string; location?: string }

export default function ExamModal({ courses, onClose, onSave }: {
  courses: Course[]
  onClose: () => void
  onSave: (exam: Exam) => void
}) {
  const [courseId, setCourseId] = useState<number>(courses[0]?.id || 0)
  const [title, setTitle] = useState('Final Exam')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!date || !courseId) return
    setSaving(true)
    const course = courses.find(c => c.id === courseId)
    const exam_date = new Date(`${date}T${time}:00`).toISOString()
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: courseId, course_name: course?.name || '', title, exam_date, location }),
    })
    const [saved] = await res.json()
    onSave(saved)
    setSaving(false)
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(26,23,20,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: '#F7F4EF', borderRadius: 18, padding: '28px 28px 24px', width: 420,
        boxShadow: '0 32px 80px rgba(24,22,15,0.22), 0 0 0 0.5px rgba(0,0,0,0.1)',
      }} onClick={e => e.stopPropagation()}>

        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9A9284', marginBottom: 6 }}>
          Add exam
        </p>
        <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em', marginBottom: 24, color: '#1A1714' }}>
          When is your exam?
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Course */}
          <div>
            <label style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9A9284', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>COURSE</label>
            <select value={courseId} onChange={e => setCourseId(Number(e.target.value))} style={{
              width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid rgba(154,146,132,0.35)',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714', background: '#fff', outline: 'none',
            }}>
              {courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>

          {/* Title */}
          <div>
            <label style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9A9284', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>EXAM TYPE</label>
            <select value={title} onChange={e => setTitle(e.target.value)} style={{
              width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid rgba(154,146,132,0.35)',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714', background: '#fff', outline: 'none',
            }}>
              <option>Final Exam</option>
              <option>Midterm Exam</option>
              <option>Quiz</option>
              <option>Lab Exam</option>
              <option>Practical</option>
            </select>
          </div>

          {/* Date + Time */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9A9284', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>DATE</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
                width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid rgba(154,146,132,0.35)',
                fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714', background: '#fff', outline: 'none',
              }} />
            </div>
            <div style={{ width: 110 }}>
              <label style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9A9284', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>TIME</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{
                width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid rgba(154,146,132,0.35)',
                fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714', background: '#fff', outline: 'none',
              }} />
            </div>
          </div>

          {/* Location */}
          <div>
            <label style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9A9284', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>LOCATION <span style={{ color: '#C4BDB0' }}>(optional)</span></label>
            <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. BioSciences 1101" style={{
              width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid rgba(154,146,132,0.35)',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#1A1714', background: '#fff', outline: 'none',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '10px', borderRadius: 100, border: '0.5px solid rgba(154,146,132,0.35)',
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#9A9284', background: 'transparent', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={save} disabled={!date || saving} style={{
            flex: 2, padding: '10px', borderRadius: 100, border: 'none',
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#fff',
            background: date ? '#1A1714' : '#C4BDB0', cursor: date ? 'pointer' : 'not-allowed',
          }}>{saving ? 'Saving…' : 'Add exam'}</button>
        </div>
      </div>
    </div>
  )
}
