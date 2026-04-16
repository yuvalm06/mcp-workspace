'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { getCourseColor } from '@/lib/courseColors'
import type { ParsedCourse } from '@/app/api/schedule-import/route'
import s from './page.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

type CalEvent = {
  id:       string
  day:      number   // 0–4 Mon–Fri (for static/recurring) or -1 for date-based
  date?:    string   // "YYYY-MM-DD" for dynamic events
  code:     string
  title:    string
  time:     string   // display "9:00 – 10:30"
  top:      number   // px from 8 AM (1 hr = 60 px)
  height:   number   // px
  colorIdx: number   // -1 = neutral study
  isStatic: boolean  // repeats every week
  dbId?:    string   // Supabase row ID
}

type Popover = { event: CalEvent; x: number; y: number }
type CreateSlot = { day: number; date: string; startHour: number; startMin: number }

// ── Static data ──────────────────────────────────────────────────────────────

type CourseItem = { id?: number; code: string; name: string; colorIdx: number }
type D2LDeadline = {
  title: string
  courseCode: string
  courseId: number
  type: string | null
  dueDateIso: string | null
  dueDate: string
  dueDateRelative: string
  viewUrl?: string
}

// Fallback if API courses haven't loaded yet
const FALLBACK_COURSES: CourseItem[] = []

const HOURS = ['8 AM','9 AM','10 AM','11 AM','12 PM','1 PM','2 PM','3 PM']

// ── Utilities ─────────────────────────────────────────────────────────────────

function getMonday(d: Date) {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const m = new Date(d)
  m.setDate(d.getDate() + diff)
  m.setHours(0,0,0,0)
  return m
}

function weekLabel(monday: Date) {
  const fri = new Date(monday); fri.setDate(monday.getDate() + 4)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(monday)} – ${fmt(fri)}`
}

function nowTopPx(monday: Date) {
  const now = new Date()
  const todayIdx = (now.getDay() + 6) % 7
  if (todayIdx > 4) return null
  const weekOf = new Date(monday); weekOf.setDate(monday.getDate() + todayIdx)
  if (weekOf.toDateString() !== now.toDateString()) return null
  const mins = (now.getHours() - 8) * 60 + now.getMinutes()
  if (mins < 0 || mins > 480) return null
  return mins
}

function toTimeStr(h: number, m: number) {
  const hh = h % 12 || 12
  const mm = m.toString().padStart(2, '0')
  const ampm = h < 12 ? 'AM' : 'PM'
  return `${hh}:${mm} ${ampm}`
}

function timeInputToTop(val: string) {
  const [h, m] = val.split(':').map(Number)
  return (h - 8) * 60 + (m ?? 0)
}

function timeInputToDisplay(val: string) {
  if (!val) return ''
  const [h, m] = val.split(':').map(Number)
  return toTimeStr(h, m ?? 0)
}

function addHour(timeVal: string) {
  const [h, m] = timeVal.split(':').map(Number)
  const total = h * 60 + (m ?? 0) + 60
  return `${String(Math.min(Math.floor(total / 60), 16)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
}

function dateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

function eventColorClass(colorIdx: number) {
  if (colorIdx === -1) return s.evStudy
  return [s.evBlue, s.evGreen, s.evWarm, s.evLavend, s.evTeal, s.evRose][colorIdx % 6]
}

// ── Week picker ───────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function WeekPicker({ currentMonday, baseMonday, onSelect, onClose }: {
  currentMonday: Date
  baseMonday:    Date
  onSelect: (offset: number) => void
  onClose:  () => void
}) {
  const [viewYear,  setViewYear]  = useState(currentMonday.getFullYear())
  const [viewMonth, setViewMonth] = useState(currentMonday.getMonth())
  const [hoverMon,  setHoverMon]  = useState<number | null>(null)

  const currentMon = getMonday(currentMonday).getTime()
  const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0)

  // Build Mon-first grid
  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const dow = firstOfMonth.getDay()
  const daysBack = dow === 0 ? 6 : dow - 1
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(firstOfMonth.getDate() - daysBack)

  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d
  })

  const prevMonth = () => viewMonth === 0 ? (setViewYear(y => y - 1), setViewMonth(11)) : setViewMonth(m => m - 1)
  const nextMonth = () => viewMonth === 11 ? (setViewYear(y => y + 1), setViewMonth(0)) : setViewMonth(m => m + 1)

  const handleClick = (d: Date) => {
    const clickedMon = getMonday(d)
    const diffWeeks = Math.round((clickedMon.getTime() - baseMonday.getTime()) / (7 * 24 * 60 * 60 * 1000))
    onSelect(diffWeeks)
    onClose()
  }

  return (
    <div className={s.weekPicker} onClick={e => e.stopPropagation()}>
      {/* Month nav */}
      <div className={s.wpNav}>
        <button className={s.wpNavBtn} onClick={e => { e.stopPropagation(); prevMonth() }}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className={s.wpMonthLabel}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className={s.wpNavBtn} onClick={e => { e.stopPropagation(); nextMonth() }}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* Day headers — Mon first */}
      <div className={s.wpDayHeaders}>
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} className={s.wpDayHeader}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className={s.wpGrid} onMouseLeave={() => setHoverMon(null)}>
        {cells.map((d, i) => {
          const inMonth  = d.getMonth() === viewMonth
          const cellMon  = getMonday(d).getTime()
          const isCurrent = cellMon === currentMon
          const isHovered = hoverMon !== null && cellMon === hoverMon
          const isToday   = d.getTime() === todayMidnight.getTime()
          const col = i % 7  // 0=Mon … 6=Sun
          return (
            <div
              key={i}
              className={[
                s.wpCell,
                !inMonth   && s.wpCellOut,
                isCurrent  && s.wpCellCurrent,
                isHovered  && s.wpCellHovered,
                col === 0  && s.wpCellStart,
                col === 6  && s.wpCellEnd,
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setHoverMon(cellMon)}
              onClick={() => handleClick(d)}
            >
              <span className={[s.wpNum, isToday && s.wpNumToday].filter(Boolean).join(' ')}>
                {d.getDate()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateForm({
  slot, days, courses, onSave, onCancel,
}: {
  slot: CreateSlot | null
  days: Date[]
  courses: CourseItem[]
  onSave: (ev: { title: string; code: string; colorIdx: number; date: string; startTime: string; endTime: string }) => void
  onCancel: () => void
}) {
  const defaultDate = slot ? slot.date : dateStr(new Date())
  const defaultStart = slot
    ? `${String(slot.startHour).padStart(2,'0')}:${String(slot.startMin).padStart(2,'0')}`
    : '09:00'

  const [title,     setTitle]     = useState('')
  const [code,      setCode]      = useState('')
  const [colorIdx,  setColorIdx]  = useState(0)
  const [date,      setDate]      = useState(defaultDate)
  const [startTime, setStartTime] = useState(defaultStart)
  const [endTime,   setEndTime]   = useState(addHour(defaultStart))
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  const handleCourseSelect = (c: CourseItem) => {
    setCode(c.code)
    setColorIdx(c.colorIdx)
  }

  const handleSave = () => {
    if (!title.trim()) return
    onSave({ title: title.trim(), code, colorIdx, date, startTime, endTime })
  }

  return (
    <div className={s.createCard} onClick={e => e.stopPropagation()}>
      <input
        ref={titleRef}
        className={s.createTitle}
        placeholder="Add title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSave()}
      />

      <div className={s.createCourses}>
        {courses.map(c => {
          const col = getCourseColor(c.colorIdx)
          return (
            <button
              key={c.code}
              className={`${s.createCourseChip} ${code === c.code ? s.createCourseChipActive : ''}`}
              style={{ background: col.tint, color: col.accent, outline: code === c.code ? `1.5px solid ${col.accent}` : 'none' }}
              onClick={() => handleCourseSelect(c)}
            >
              {c.code}
            </button>
          )
        })}
      </div>

      <div className={s.createFields}>
        <input type="date" className={s.createField} value={date} onChange={e => setDate(e.target.value)} />
        <input type="time" className={s.createField} value={startTime} onChange={e => { setStartTime(e.target.value); setEndTime(addHour(e.target.value)) }} />
        <span className={s.createFieldSep}>→</span>
        <input type="time" className={s.createField} value={endTime} onChange={e => setEndTime(e.target.value)} />
      </div>

      <div className={s.createActions}>
        <button className={s.createCancel} onClick={onCancel}>Cancel</button>
        <button className={s.createSave} onClick={handleSave} disabled={!title.trim()}>Save</button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Import Wizard ─────────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type WizardStep = 'choose' | 'screenshot' | 'manual' | 'preview'

function ImportWizard({ courses: courseList, onDone, onClose }: {
  courses: CourseItem[]
  onDone: (events: CalEvent[]) => void
  onClose: () => void
}) {
  const [step,         setStep]         = useState<WizardStep>('choose')
  const [image,        setImage]        = useState<string | null>(null)
  const [notes,        setNotes]        = useState('')
  const [parsing,      setParsing]      = useState(false)
  const [parseError,   setParseError]   = useState('')
  const [parsed,       setParsed]       = useState<ParsedCourse[]>([])
  const [selected,     setSelected]     = useState<Set<number>>(new Set())
  const [semesterEnd,  setSemesterEnd]  = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 112); return d.toISOString().slice(0, 10)
  })
  const [saving,       setSaving]       = useState(false)

  // Manual form state
  const [mCode,   setMCode]   = useState('')
  const [mTitle,  setMTitle]  = useState('')
  const [mType,   setMType]   = useState<'lecture' | 'tutorial' | 'lab' | 'studio' | 'other'>('lecture')
  const [mDays,   setMDays]   = useState<number[]>([])
  const [mStart,  setMStart]  = useState('09:00')
  const [mEnd,    setMEnd]    = useState('10:30')
  const [mBiweek, setMBiweek] = useState(false)
  const [manualList, setManualList] = useState<ParsedCourse[]>([])

  const dropRef = useRef<HTMLDivElement>(null)

  const readImageFromClipboard = (items: DataTransferItemList | null) => {
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = () => {
          setImage(reader.result as string)
          if (step === 'choose') setStep('screenshot')
        }
        reader.readAsDataURL(file)
        return true
      }
    }
    return false
  }

  // Auto-focus drop zone when screenshot step opens so paste works immediately
  useEffect(() => {
    if (step === 'screenshot') {
      setTimeout(() => dropRef.current?.focus(), 50)
    }
  }, [step])

  // Window-level paste — works regardless of focus
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (readImageFromClipboard(e.clipboardData?.items ?? null)) {
        e.preventDefault()
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [step])   // re-register when step changes so closure has current step

  // File drop handler
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file?.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  const parseImage = async () => {
    if (!image) return
    setParsing(true); setParseError('')
    try {
      const res = await fetch('/api/schedule-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, notes }),
      })
      const data = await res.json()
      if (!res.ok) { setParseError(data.error || 'Failed to parse'); return }
      setParsed(data.courses)
      setSelected(new Set(data.courses.map((_: any, i: number) => i)))
      setStep('preview')
    } catch {
      setParseError('Something went wrong. Try again.')
    } finally {
      setParsing(false)
    }
  }

  const addManualEntry = () => {
    if (!mCode.trim() || !mDays.length) return
    setManualList(prev => [...prev, {
      courseCode: mCode.trim().toUpperCase(),
      title: mTitle.trim() || mCode.trim().toUpperCase(),
      type: mType,
      days: [...mDays].sort(),
      startTime: mStart,
      endTime: mEnd,
      biweekly: mBiweek,
      notes: '',
    }])
    setMCode(''); setMTitle(''); setMDays([]); setMBiweek(false)
  }

  const goPreviewManual = () => {
    if (!manualList.length) return
    setParsed(manualList)
    setSelected(new Set(manualList.map((_, i) => i)))
    setStep('preview')
  }

  const saveSchedule = async () => {
    const toSave = parsed.filter((_, i) => selected.has(i))
    if (!toSave.length) return
    setSaving(true)
    try {
      const colorMap: Record<string, number> = {}
      toSave.forEach(c => {
        // Match ignoring semester suffix: "MECH 210 W26" matches "MECH 210"
        const idx = courseList.findIndex(cl =>
          cl.code === c.courseCode || cl.code.toUpperCase().startsWith(c.courseCode.toUpperCase())
        )
        if (idx >= 0) colorMap[c.courseCode] = courseList[idx].colorIdx
      })
      const res = await fetch('/api/calendar-events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courses: toSave, semesterEnd, colorMap }),
      })
      if (res.ok) {
        onDone([])   // parent will refetch
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleDay = (d: number) =>
    setMDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])

  return (
    <div className={s.wizardOverlay} onClick={onClose}>
      <div className={s.wizardCard} onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button className={s.wizardClose} onClick={onClose}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        {/* ── CHOOSE ── */}
        {step === 'choose' && (
          <>
            <p className={s.wizardEyebrow}>Schedule setup</p>
            <h2 className={s.wizardTitle}>How do you want to add your schedule?</h2>
            <div className={s.wizardOptions}>
              <button className={s.wizardOption} onClick={() => setStep('screenshot')}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className={s.wizardOptTitle}>Screenshot</span>
                <span className={s.wizardOptDesc}>Paste your SOLUS schedule — Quill reads it automatically</span>
              </button>
              <button className={s.wizardOption} onClick={() => setStep('manual')}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                <span className={s.wizardOptTitle}>Manual</span>
                <span className={s.wizardOptDesc}>Enter each course, days, and times yourself</span>
              </button>
            </div>
          </>
        )}

        {/* ── SCREENSHOT ── */}
        {step === 'screenshot' && (
          <>
            <p className={s.wizardEyebrow}>Schedule setup · Screenshot</p>
            <h2 className={s.wizardTitle}>Paste your SOLUS schedule</h2>
            <p className={s.wizardSub}>Take a screenshot in SOLUS and paste it here (Cmd+V), or drag and drop an image file.</p>
            <div className={s.screenshotTip}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>Make sure the screenshot shows the <strong>full week</strong> and that the text inside each course block (code, time, type) is <strong>clearly readable</strong>. Zoom in if needed before screenshotting.</span>
            </div>

            <div
              ref={dropRef}
              className={`${s.dropZone} ${image ? s.dropZoneHasImage : ''}`}
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
              onPaste={e => readImageFromClipboard(e.clipboardData?.items ?? null)}
              tabIndex={0}
            >
              {image ? (
                <div className={s.imagePreview}>
                  <img src={image} alt="Schedule screenshot" className={s.previewImg} />
                  <button className={s.clearImage} onClick={() => setImage(null)}>
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ) : (
                <label className={s.dropLabel}>
                  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <span>Paste (Cmd+V) or click to upload</span>
                  <input type="file" accept="image/*" onChange={onFileInput} style={{ display: 'none' }} />
                </label>
              )}
            </div>

            <textarea
              className={s.wizardNotes}
              placeholder="Any notes? e.g. 'MECH 228 tutorial is every other week'"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
            />

            {parseError && <p className={s.wizardError}>{parseError}</p>}

            <div className={s.wizardActions}>
              <button className={s.wizardBack} onClick={() => setStep('choose')}>Back</button>
              <button
                className={s.wizardPrimary}
                disabled={!image || parsing}
                onClick={parseImage}
              >
                {parsing ? 'Reading schedule…' : 'Parse schedule'}
              </button>
            </div>
          </>
        )}

        {/* ── MANUAL ── */}
        {step === 'manual' && (
          <>
            <p className={s.wizardEyebrow}>Schedule setup · Manual</p>
            <h2 className={s.wizardTitle}>Add your courses</h2>

            <div className={s.manualForm}>
              <div className={s.manualRow}>
                <input className={s.manualInput} placeholder="Code  e.g. MECH 241" value={mCode} onChange={e => setMCode(e.target.value)} />
                <input className={s.manualInput} placeholder="Course name (optional)" value={mTitle} onChange={e => setMTitle(e.target.value)} />
              </div>
              <div className={s.manualRow}>
                <select className={s.manualSelect} value={mType} onChange={e => setMType(e.target.value as any)}>
                  <option value="lecture">Lecture</option>
                  <option value="tutorial">Tutorial</option>
                  <option value="lab">Lab</option>
                  <option value="studio">Studio</option>
                  <option value="other">Other</option>
                </select>
                <div className={s.manualDays}>
                  {DAY_NAMES.map((d, i) => (
                    <button
                      key={i}
                      className={`${s.dayChip} ${mDays.includes(i) ? s.dayChipOn : ''}`}
                      onClick={() => toggleDay(i)}
                    >{d}</button>
                  ))}
                </div>
              </div>
              <div className={s.manualRow}>
                <input type="time" className={s.manualInput} value={mStart} onChange={e => setMStart(e.target.value)} />
                <span className={s.timeSep}>→</span>
                <input type="time" className={s.manualInput} value={mEnd} onChange={e => setMEnd(e.target.value)} />
                <label className={s.biweekLabel}>
                  <input type="checkbox" checked={mBiweek} onChange={e => setMBiweek(e.target.checked)} />
                  Every other week
                </label>
              </div>
              <button className={s.addEntryBtn} onClick={addManualEntry} disabled={!mCode.trim() || !mDays.length}>
                + Add entry
              </button>
            </div>

            {manualList.length > 0 && (
              <div className={s.manualList}>
                {manualList.map((c, i) => (
                  <div key={i} className={s.manualListItem}>
                    <span className={s.manualListCode}>{c.courseCode}</span>
                    <span className={s.manualListDays}>{c.days.map(d => DAY_NAMES[d]).join(' · ')}</span>
                    <span className={s.manualListTime}>{c.startTime} – {c.endTime}</span>
                    {c.biweekly && <span className={s.manualListBiweek}>biweekly</span>}
                    <button className={s.manualListDel} onClick={() => setManualList(prev => prev.filter((_, j) => j !== i))}>
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={s.wizardActions}>
              <button className={s.wizardBack} onClick={() => setStep('choose')}>Back</button>
              <button className={s.wizardPrimary} disabled={!manualList.length} onClick={goPreviewManual}>
                Preview ({manualList.length})
              </button>
            </div>
          </>
        )}

        {/* ── PREVIEW ── */}
        {step === 'preview' && (
          <>
            <p className={s.wizardEyebrow}>Schedule setup · Preview</p>
            <h2 className={s.wizardTitle}>Confirm your schedule</h2>
            <p className={s.wizardSub}>Uncheck anything wrong. Missing a course? Add it below.</p>

            <div className={s.previewList}>
              {parsed.map((c, i) => {
                const on = selected.has(i)
                const courseIdx = courseList.findIndex(cl => cl.code === c.courseCode || cl.code.toUpperCase().startsWith(c.courseCode.toUpperCase()))
                const color = courseIdx >= 0 ? getCourseColor(courseList[courseIdx].colorIdx) : { tint: 'rgba(154,146,132,0.10)', accent: 'var(--ink-muted)' }
                return (
                  <label key={i} className={`${s.previewItem} ${!on ? s.previewItemOff : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setSelected(prev => {
                        const next = new Set(prev)
                        next.has(i) ? next.delete(i) : next.add(i)
                        return next
                      })}
                      className={s.previewCheck}
                    />
                    <span className={s.previewCode} style={{ background: color.tint, color: color.accent }}>{c.courseCode}</span>
                    <div className={s.previewMeta}>
                      <span className={s.previewType}>{c.type}</span>
                      <span className={s.previewDays}>{c.days.map(d => DAY_NAMES[d]).join(' · ')} · {c.startTime} – {c.endTime}</span>
                      {c.biweekly && <span className={s.previewBiweek}>every other week</span>}
                    </div>
                    <button
                      className={s.previewDel}
                      onClick={e => { e.preventDefault(); setParsed(prev => prev.filter((_, j) => j !== i)); setSelected(prev => { const n = new Set(prev); n.delete(i); return n }) }}
                      title="Remove"
                    >
                      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </label>
                )
              })}
            </div>

            {/* Inline add-missing form */}
            <div className={s.addMissingRow}>
              <input className={s.addMissingInput} placeholder="Code  e.g. MECH 228" value={mCode} onChange={e => setMCode(e.target.value)} />
              <select className={s.manualSelect} value={mType} onChange={e => setMType(e.target.value as any)}>
                <option value="lecture">Lecture</option>
                <option value="tutorial">Tutorial</option>
                <option value="lab">Lab</option>
                <option value="studio">Studio</option>
                <option value="other">Other</option>
              </select>
              <div className={s.manualDays}>
                {DAY_NAMES.map((d, i) => (
                  <button key={i} className={`${s.dayChip} ${mDays.includes(i) ? s.dayChipOn : ''}`} onClick={() => toggleDay(i)}>{d}</button>
                ))}
              </div>
              <input type="time" className={s.addMissingInput} value={mStart} onChange={e => setMStart(e.target.value)} style={{ maxWidth: 110 }} />
              <span className={s.timeSep}>→</span>
              <input type="time" className={s.addMissingInput} value={mEnd} onChange={e => setMEnd(e.target.value)} style={{ maxWidth: 110 }} />
              <button
                className={s.addEntryBtn}
                disabled={!mCode.trim() || !mDays.length}
                onClick={() => {
                  const entry: ParsedCourse = {
                    courseCode: mCode.trim().toUpperCase(),
                    title: mCode.trim().toUpperCase(),
                    type: mType, days: [...mDays].sort(),
                    startTime: mStart, endTime: mEnd, biweekly: mBiweek, notes: '',
                  }
                  setParsed(prev => [...prev, entry])
                  setSelected(prev => { const n = new Set(prev); n.add(parsed.length); return n })
                  setMCode(''); setMDays([])
                }}
              >+ Add</button>
            </div>

            <div className={s.semesterRow}>
              <label className={s.semesterLabel}>Repeat until</label>
              <input
                type="date"
                className={s.semesterInput}
                value={semesterEnd}
                onChange={e => setSemesterEnd(e.target.value)}
              />
            </div>

            <div className={s.wizardActions}>
              <button className={s.wizardBack} onClick={() => setStep(image ? 'screenshot' : 'manual')}>Back</button>
              <button
                className={s.wizardPrimary}
                disabled={!selected.size || saving}
                onClick={saveSchedule}
              >
                {saving ? 'Adding…' : `Add ${selected.size} course${selected.size !== 1 ? 's' : ''} to calendar`}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

function getISOWeek(d: Date) {
  const date = new Date(d); date.setHours(0,0,0,0)
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7)
  const jan4 = new Date(date.getFullYear(), 0, 4)
  return 1 + Math.round(((date.getTime() - jan4.getTime()) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7)
}

export default function SchedulePage() {
  const [weekOffset,    setWeekOffset]   = useState(0)
  const [nowPx,         setNowPx]        = useState<number | null>(null)
  const [dynEvents,     setDynEvents]    = useState<CalEvent[]>([])
  const [courseList,    setCourseList]   = useState<CourseItem[]>(FALLBACK_COURSES)
  const [d2lDeadlines,  setD2lDeadlines] = useState<D2LDeadline[]>([])
  const [wizardOpen,    setWizardOpen]   = useState(false)
  const [popover,       setPopover]      = useState<Popover | null>(null)
  const [creating,      setCreating]     = useState<CreateSlot | null>(null)
  const [showCreate,    setShowCreate]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [pickerOpen,    setPickerOpen]   = useState(false)

  const baseMonday = getMonday(new Date())
  const monday = new Date(baseMonday)
  monday.setDate(baseMonday.getDate() + weekOffset * 7)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i); return d
  })

  const today = new Date(); today.setHours(0,0,0,0)
  const isCurrentWeek = weekOffset === 0
  const weekNum = getISOWeek(monday)

  const fetchCalendarEvents = useCallback(() => {
    fetch('/api/calendar-events')
      .then(r => r.json())
      .then((rows: any[]) => {
        const events: CalEvent[] = rows.map(r => {
          const [sh, sm] = r.start_time.split(':').map(Number)
          const [eh, em] = r.end_time.split(':').map(Number)
          const top    = (sh - 8) * 60 + sm
          const height = (eh * 60 + em) - (sh * 60 + sm)
          return {
            id: r.id, day: -1, date: r.date, code: r.code ?? '',
            title: r.title, time: `${timeInputToDisplay(r.start_time)} – ${timeInputToDisplay(r.end_time)}`,
            top, height, colorIdx: r.color_idx ?? 0, isStatic: false, dbId: r.id,
          }
        })
        setDynEvents(events)
      })
      .catch(() => {})
  }, [])

  // Load dynamic events and courses on mount
  useEffect(() => {
    fetchCalendarEvents()

    fetch('/api/courses')
      .then(r => r.ok ? r.json() : [])
      .then((courses: any[]) => {
        if (Array.isArray(courses) && courses.length) {
          setCourseList(courses.map((c, i) => ({ id: Number(c.id), code: c.code, name: c.name, colorIdx: i })))
        }
      })
      .catch(() => {})

    fetch('/api/deadlines?daysAhead=60')
      .then(r => r.ok ? r.json() : [])
      .then((items: D2LDeadline[]) => { if (Array.isArray(items)) setD2lDeadlines(items) })
      .catch(() => {})
  }, [])

  // Now line
  useEffect(() => {
    if (!isCurrentWeek) { setNowPx(null); return }
    const update = () => setNowPx(nowTopPx(monday))
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [weekOffset])

  // Close popover on outside click
  const closePopover = useCallback(() => setPopover(null), [])

  // ── Event handlers ────────────────────────────────────────────────────────

  const openPopover = (ev: CalEvent, e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = rect.right + 10
    const y = rect.top
    setPopover({ event: ev, x, y })
  }

  const handleGridClick = (dayIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (popover) { setPopover(null); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relY = e.clientY - rect.top
    const totalMins = Math.floor(relY / 60) * 60  // snap to hour
    const startHour = 8 + Math.floor(totalMins / 60)
    const startMin  = totalMins % 60
    setCreating({ day: dayIdx, date: dateStr(days[dayIdx]), startHour, startMin })
    setShowCreate(false)  // using the inline slot form, not the + form
    setPopover(null)
  }

  const handleSaveEvent = async (fields: { title: string; code: string; colorIdx: number; date: string; startTime: string; endTime: string }) => {
    const [sh, sm] = fields.startTime.split(':').map(Number)
    const [eh, em] = fields.endTime.split(':').map(Number)
    const top    = (sh - 8) * 60 + sm
    const height = (eh * 60 + em) - (sh * 60 + sm)

    const optimisticId = `opt-${Date.now()}`
    const newEvent: CalEvent = {
      id:       optimisticId,
      day:      -1,
      date:     fields.date,
      code:     fields.code,
      title:    fields.title,
      time:     `${timeInputToDisplay(fields.startTime)} – ${timeInputToDisplay(fields.endTime)}`,
      top, height,
      colorIdx: fields.colorIdx,
      isStatic: false,
    }
    setDynEvents(ev => [...ev, newEvent])
    setCreating(null)
    setShowCreate(false)

    try {
      const res  = await fetch('/api/calendar-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const row = await res.json()
      if (row.id) {
        setDynEvents(ev => ev.map(e => e.id === optimisticId ? { ...e, id: row.id, dbId: row.id } : e))
      }
    } catch {}
  }

  const handleDelete = async (ev: CalEvent) => {
    setDynEvents(prev => prev.filter(e => e.id !== ev.id))
    setPopover(null)
    setDeleteConfirm(null)
    if (ev.dbId) {
      try { await fetch(`/api/calendar-events/${ev.dbId}`, { method: 'DELETE' }) } catch {}
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const eventsForDay = (dayIdx: number, dayDate: Date) => {
    const ds = dateStr(dayDate)
    return dynEvents.filter(e => e.date === ds)
  }

  // Upcoming = dynEvents on or after today, sorted, next 5
  const upcomingEvents = dynEvents
    .filter(e => e.date && e.date >= dateStr(today))
    .sort((a, b) => {
      if (a.date! < b.date!) return -1
      if (a.date! > b.date!) return 1
      return a.top - b.top
    })
    .slice(0, 5)

  function upcomingWhen(ev: CalEvent): string {
    if (!ev.date) return ''
    const d = new Date(ev.date + 'T00:00')
    const todayStr = dateStr(today)
    const tomorrowStr = dateStr(new Date(today.getTime() + 86400000))
    const prefix = ev.date === todayStr ? 'Today' : ev.date === tomorrowStr ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const timePart = ev.time.split(' – ')[0]
    return `${prefix} · ${timePart}`
  }

  return (
    <div className={s.wrap} onClick={() => { closePopover(); setPickerOpen(false) }}>

      <div className={s.main}>
        {/* Header */}
        <div className={s.header}>
          <div>
            <p className={s.eyebrow}>Week {weekNum} · {monday.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
            <h1 className={s.title}>Your <em>week.</em></h1>
          </div>
          <button className={s.setupBtn} onClick={e => { e.stopPropagation(); setWizardOpen(true) }} title="Set up schedule">
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Set up schedule
          </button>
          <div className={s.weekNav}>
            <button className={s.weekNavBtn} onClick={e => { e.stopPropagation(); setWeekOffset(o => o - 1) }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>

            <div style={{ position: 'relative' }}>
              <button
                className={`${s.weekLabel} ${s.weekLabelBtn}`}
                onClick={e => { e.stopPropagation(); setPickerOpen(o => !o) }}
              >
                {weekLabel(monday)}
              </button>
              {pickerOpen && (
                <WeekPicker
                  currentMonday={monday}
                  baseMonday={baseMonday}
                  onSelect={setWeekOffset}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>

            <button className={s.weekNavBtn} onClick={e => { e.stopPropagation(); setWeekOffset(o => o + 1) }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>

        {/* Calendar */}
        <div className={s.calWrap}>
          {/* Day headers */}
          <div className={s.calHeader}>
            <div />
            {days.map((d, i) => {
              const isToday = d.getTime() === today.getTime()
              return (
                <div key={i} className={s.calDayHead}>
                  <div className={s.calDayName}>{['MON','TUE','WED','THU','FRI','SAT','SUN'][i]}</div>
                  <div className={`${s.calDayNum} ${isToday ? s.calDayNumToday : ''}`}>{d.getDate()}</div>
                </div>
              )
            })}

          </div>

          {/* Grid */}
          <div className={s.calGrid}>
            <div className={s.calTimeCol}>
              {HOURS.map(h => (
                <div key={h} className={s.calTimeSlot} style={{ height: 60 }}>{h}</div>
              ))}
            </div>

            {days.map((d, dayIdx) => {
              const isToday = d.getTime() === today.getTime()
              const events  = eventsForDay(dayIdx, d)
              return (
                <div
                  key={dayIdx}
                  className={`${s.calCol} ${isToday ? s.calColToday : ''}`}
                  onClick={e => handleGridClick(dayIdx, e)}
                >
                  <div className={s.calColInner}>
                    {HOURS.map((_, hi) => (
                      <div key={hi} className={s.hourLine} style={{ top: hi * 60 }} />
                    ))}

                    {events.map(ev => (
                      <div
                        key={ev.id}
                        className={`${s.calEvent} ${eventColorClass(ev.colorIdx)} ${isToday ? s.evToday : ''}`}
                        style={{ top: ev.top, height: ev.height }}
                        onClick={e => openPopover(ev, e)}
                      >
                        <div className={s.calEventName}>{ev.title || ev.code}</div>
                        <div className={s.calEventTime}>{ev.time}</div>
                      </div>
                    ))}

                    {/* Placeholder block while creating */}
                    {creating && creating.day === dayIdx && (
                      <div
                        className={`${s.calEvent} ${s.evPlaceholder}`}
                        style={{
                          top:    timeInputToTop(`${String(creating.startHour).padStart(2,'0')}:${String(creating.startMin).padStart(2,'0')}`),
                          height: 60,
                        }}
                      />
                    )}

                    {isToday && nowPx !== null && (
                      <div className={s.nowLine} style={{ top: nowPx }}>
                        <div className={s.nowLineBar} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

          </div>
        </div>

        {/* + button */}
        <button
          className={s.plusBtn}
          onClick={e => { e.stopPropagation(); setShowCreate(true); setCreating(null) }}
          title="New event"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      {/* Right panel */}
      <div className={s.rightPanel}>
        <div className={s.upcomingSection}>
          <p className={s.panelLabel}>Upcoming</p>
          <div className={s.todayList}>
            {upcomingEvents.length === 0 && d2lDeadlines.length === 0 && (
              <p className={s.upcomingEmpty}>No upcoming events — add one to the calendar.</p>
            )}
            {upcomingEvents.map((ev, i) => {
              const c = ev.colorIdx >= 0 ? getCourseColor(ev.colorIdx) : { tint: 'var(--surface)', accent: 'var(--ink-muted)' }
              return (
                <div key={`usr-${i}`} className={s.todayItem}>
                  <div className={s.evHeader}>
                    {ev.code && (
                      <span className={s.evCoursePill} style={{ background: c.tint, color: c.accent }}>
                        {ev.code}
                      </span>
                    )}
                  </div>
                  <p className={s.todayTitle}>{ev.title}</p>
                  <p className={s.todaySub}>{upcomingWhen(ev)}</p>
                </div>
              )
            })}
            {d2lDeadlines.slice(0, 8).map((ev, i) => {
              const courseIdx = courseList.findIndex(c => c.code === ev.courseCode)
              const color = courseIdx >= 0 ? getCourseColor(courseIdx) : { tint: 'rgba(154,146,132,0.10)', accent: 'var(--ink-muted)' }
              const typeLabel = ev.type === 'assignment' ? 'Due' : ev.type === 'exam' ? 'Exam' : 'Event'
              return (
                <a
                  key={`d2l-${i}`}
                  href={ev.viewUrl || '#'}
                  target={ev.viewUrl ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className={`${s.todayItem} ${s.todayItemD2l}`}
                >
                  <div className={s.evHeader}>
                    <span className={s.d2lTypeBadge}>{typeLabel}</span>
                    {ev.courseCode && (
                      <span className={s.evCoursePill} style={{ background: color.tint, color: color.accent }}>
                        {ev.courseCode}
                      </span>
                    )}
                  </div>
                  <p className={s.todayTitle}>{ev.title}</p>
                  <p className={s.todaySub}>{ev.dueDate}{ev.dueDateRelative ? ` · ${ev.dueDateRelative}` : ''}</p>
                </a>
              )
            })}
          </div>
        </div>

        <Link href="/ask" className={s.chatPreview}>
          <div className={s.cpTop}>
            <div className={s.cpDot} />
            <span className={s.cpLabel}>Ask Quill</span>
          </div>
          <p className={s.cpMsg}>Need to prep for an upcoming class? Start a study session.</p>
          <p className={s.cpCta}>Start a chat →</p>
        </Link>
      </div>

      {/* ── Popover ── */}
      {popover && (
        <div
          className={s.popover}
          style={{
            left: Math.min(popover.x, window.innerWidth - 260),
            top:  Math.min(popover.y, window.innerHeight - 180),
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className={s.popoverHead}>
            <span
              className={s.popoverDot}
              style={{ background: popover.event.colorIdx >= 0 ? getCourseColor(popover.event.colorIdx).accent : 'var(--ink-ghost)' }}
            />
            <span className={s.popoverTitle}>{popover.event.title || popover.event.code}</span>
            <button className={s.popoverX} onClick={() => setPopover(null)}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className={s.popoverTime}>{popover.event.time}</p>
          {popover.event.date && (
            <p className={s.popoverDate}>{new Date(popover.event.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          )}
          {!popover.event.isStatic && (
            <div className={s.popoverActions}>
              {deleteConfirm === popover.event.id ? (
                <>
                  <span className={s.popoverConfirmText}>Delete?</span>
                  <button className={s.popoverActionBtn} onClick={() => handleDelete(popover.event)} style={{ color: '#D45050' }}>Yes</button>
                  <button className={s.popoverActionBtn} onClick={() => setDeleteConfirm(null)}>No</button>
                </>
              ) : (
                <button className={s.popoverActionBtn} style={{ color: '#D45050' }} onClick={() => setDeleteConfirm(popover.event.id)}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Create form (slot click or + button) ── */}
      {(creating || showCreate) && (
        <div className={s.createOverlay} onClick={() => { setCreating(null); setShowCreate(false) }}>
          <CreateForm
            slot={creating}
            days={days}
            courses={courseList}
            onSave={handleSaveEvent}
            onCancel={() => { setCreating(null); setShowCreate(false) }}
          />
        </div>
      )}

      {/* ── Import wizard ── */}
      {wizardOpen && (
        <ImportWizard
          courses={courseList}
          onDone={() => fetchCalendarEvents()}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  )
}
