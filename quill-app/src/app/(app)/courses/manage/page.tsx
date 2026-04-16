'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getHiddenCourseIds, saveHiddenCourseIds } from '@/lib/coursePrefs'
import s from './page.module.css'

type Course = { id: number; name: string; code: string; canAccess: boolean }

const COLOR_PALETTE = [
  '#C8D8EB', '#C2D9C2', '#E0CCB0', '#C8C0DC',
  '#DCC0C0', '#B8CCBC', '#B8CCD8', '#E8C4B0',
]

function defaultColor(index: number) {
  return COLOR_PALETTE[index % COLOR_PALETTE.length]
}

export default function ManageCoursesPage() {
  const [courses,  setCourses]  = useState<Course[]>([])
  const [loading,  setLoading]  = useState(true)
  const [visible,  setVisible]  = useState<Record<number, boolean>>({})
  const [colors,   setColors]   = useState<Record<number, string>>({})
  const [openPicker, setOpenPicker] = useState<number | null>(null)
  const [dirty,    setDirty]    = useState(false)

  // snapshots for discard
  const [savedVisible, setSavedVisible] = useState<Record<number, boolean>>({})
  const [savedColors,  setSavedColors]  = useState<Record<number, string>>({})

  useEffect(() => {
    fetch('/api/courses')
      .then(r => r.json())
      .then((data: Course[]) => {
        setCourses(data)
        const hiddenIds = new Set(getHiddenCourseIds())
        const v: Record<number, boolean> = {}
        const c: Record<number, string>  = {}
        data.forEach((course, i) => {
          v[course.id] = !hiddenIds.has(course.id)
          c[course.id] = defaultColor(i)
        })
        setVisible(v);  setSavedVisible(v)
        setColors(c);   setSavedColors(c)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const markDirty = () => setDirty(true)

  const toggleVisible = (id: number) => {
    setVisible(prev => ({ ...prev, [id]: !prev[id] }))
    markDirty()
  }

  const pickColor = (id: number, color: string) => {
    setColors(prev => ({ ...prev, [id]: color }))
    setOpenPicker(null)
    markDirty()
  }

  const save = () => {
    const hiddenIds = Object.entries(visible)
      .filter(([, on]) => !on)
      .map(([id]) => Number(id))
    saveHiddenCourseIds(hiddenIds)
    setSavedVisible({ ...visible })
    setSavedColors({ ...colors })
    setDirty(false)
  }

  const discard = () => {
    setVisible({ ...savedVisible })
    setColors({ ...savedColors })
    setOpenPicker(null)
    setDirty(false)
  }

  return (
    <div className={s.main} onClick={e => {
      // close picker on outside click
      if (openPicker !== null && !(e.target as Element).closest('[data-row]')) {
        setOpenPicker(null)
      }
    }}>

      <div>
        <Link href="/" className={s.backLink}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to home
        </Link>
      </div>

      <div>
        <p className={s.eyebrow}>Courses</p>
        <h1 className={s.title}>Manage courses</h1>
      </div>

      <div>
        <span className={s.sectionLabel}>Visible on dashboard</span>

        <div className={s.courseList}>
          {loading && (
            <p style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-ghost)' }}>Loading…</p>
          )}

          {courses.map((course, i) => {
            const isOn     = visible[course.id] ?? true
            const color    = colors[course.id]  ?? defaultColor(i)
            const isOpen   = openPicker === course.id

            return (
              <div
                key={course.id}
                data-row={course.id}
                className={`${s.courseRow} ${!isOn ? s.courseRowHidden : ''}`}
              >
                {/* Color swatch */}
                <div
                  className={`${s.swatch} ${isOpen ? s.swatchOpen : ''}`}
                  style={{ background: color }}
                  onClick={e => { e.stopPropagation(); setOpenPicker(isOpen ? null : course.id) }}
                  title="Change color"
                />

                {/* Course info + color picker */}
                <div className={s.courseInner}>
                  <p className={s.courseCode}>{course.code}</p>
                  <p className={s.courseName}>{course.name}</p>
                  <div className={`${s.colorPicker} ${isOpen ? s.colorPickerOpen : ''}`}>
                    {COLOR_PALETTE.map(c => (
                      <div
                        key={c}
                        className={`${s.colorDot} ${color === c ? s.colorDotActive : ''}`}
                        style={{ background: c }}
                        onClick={e => { e.stopPropagation(); pickColor(course.id, c) }}
                      />
                    ))}
                  </div>
                </div>

                {/* Toggle */}
                <button
                  className={`${s.toggle} ${isOn ? s.toggleOn : ''}`}
                  onClick={() => toggleVisible(course.id)}
                  aria-label={isOn ? 'Hide course' : 'Show course'}
                />
              </div>
            )
          })}
        </div>

        {/* Save bar */}
        <div className={`${s.saveBar} ${dirty ? s.saveBarVisible : ''}`}>
          <button className={s.btnDiscard} onClick={discard}>Discard</button>
          <button className={s.btnSave}    onClick={save}>Save changes</button>
        </div>
      </div>

    </div>
  )
}
