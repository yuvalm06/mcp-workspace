'use client'
import { useState } from 'react'
import { useRoutine, ActionType, TriggerType } from '@/lib/routineContext'
import s from './RoutinesModal.module.css'

// ── Static labels ─────────────────────────────────────────────────────────────

const TRIGGER_EVENTS = [
  { key: 'new_lecture',      label: 'New lecture posted' },
  { key: 'exam_3days',       label: 'Exam in N days' },
  { key: 'new_announcement', label: 'New announcement' },
]
const TRIGGER_SCHEDULES = [
  { key: 'every_morning', label: 'Every morning' },
  { key: 'every_sunday',  label: 'Every Sunday evening' },
  { key: 'before_lecture',label: 'Before every lecture' },
  { key: 'custom',        label: 'Custom' },
]
const COURSES   = ['MECH 241','MECH 210','MECH 228','MECH 203','APSC 200','MECH 273']
const WEEK_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const FREQS     = ['Weekly','Bi-weekly','Monthly'] as const
type Freq = typeof FREQS[number]

const EMOJI_OPTIONS = ['📚','📝','🎯','🔁','📅','⚡','🧠','💡','🔔','📖','✅','🗓️','🎓','🏆','💪','🌅']

const COURSE_COLORS: Record<string, string> = {
  'MECH 241': '#3A5F9E',
  'MECH 210': '#6B5BAB',
  'MECH 228': '#2B7A4B',
  'MECH 203': '#C07030',
  'APSC 200': '#B03030',
  'MECH 273': '#1A7A8A',
}
const PALETTE = ['#3A5F9E','#6B5BAB','#2B7A4B','#C07030','#B03030','#1A7A8A','#8B6B3D','#555555']

const ACTIONS: { key: ActionType; label: string; plain: string }[] = [
  { key: 'summarize',       label: 'Summarize new content',          plain: 'summarize it' },
  { key: 'recall_set',      label: 'Build a recall set',             plain: 'build a recall set' },
  { key: 'practice_exam',   label: 'Build a practice exam',          plain: 'build a practice exam' },
  { key: 'briefing',        label: 'Send me a briefing',             plain: 'send you a briefing' },
  { key: 'quiz_weakest',    label: 'Quiz me on weakest topics',      plain: 'quiz you on your weakest topics' },
  { key: 'break_down',      label: 'Break down an assignment',       plain: 'break down the assignment' },
  { key: 'add_study_block', label: 'Add study block to calendar',    plain: 'add a study block to your calendar' },
  { key: 'notify',          label: 'Notify me',                      plain: 'notify you' },
]
const TEMPLATES = [
  { name: 'Stay caught up',  emoji: '📚', desc: 'New lecture posted → summarize it → notify me',                    triggerType: 'event' as TriggerType,    triggerSub: 'new_lecture',   actions: ['summarize','notify'] as ActionType[] },
  { name: 'Exam prep',       emoji: '🎯', desc: 'Exam in 3 days → build a practice set → add study block',          triggerType: 'event' as TriggerType,    triggerSub: 'exam_3days',    actions: ['practice_exam','add_study_block'] as ActionType[] },
  { name: 'Weekly review',   emoji: '🔁', desc: 'Every Sunday → quiz me on weakest topics across all courses',       triggerType: 'schedule' as TriggerType, triggerSub: 'every_sunday',  actions: ['quiz_weakest'] as ActionType[] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerText(type: TriggerType | null, sub: string | null): string {
  if (type === 'manual') return 'When you ask'
  if (type === 'event')  return TRIGGER_EVENTS.find(e => e.key === sub)?.label.replace('N days','3 days') ?? 'When something happens'
  if (type === 'schedule') return TRIGGER_SCHEDULES.find(e => e.key === sub)?.label ?? 'On a schedule'
  return '...'
}

function autoEmoji(actions: ActionType[]): string {
  if (actions.includes('summarize'))       return '📝'
  if (actions.includes('practice_exam'))   return '🎯'
  if (actions.includes('quiz_weakest'))    return '🔁'
  if (actions.includes('add_study_block')) return '📅'
  return '⚡'
}

function autoName(triggerSub: string | null, triggerType: TriggerType | null, actions: ActionType[]): string {
  if (actions.includes('summarize')     && triggerSub === 'new_lecture') return 'Lecture catch-up'
  if (actions.includes('practice_exam') && triggerSub === 'exam_3days')  return 'Exam prep'
  if (actions.includes('quiz_weakest')  && triggerSub === 'every_sunday')return 'Weekly review'
  if (triggerType === 'manual') return 'On-demand'
  return 'My'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH  = diffMs / 3600000
  if (diffH < 1)   return 'Just now'
  if (diffH < 24)  return `${Math.floor(diffH)}h ago`
  if (diffH < 48)  return `Yesterday at ${d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' at ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className={`${s.toggle} ${on ? s.toggleOn : ''}`} onClick={e => { e.stopPropagation(); onToggle() }}>
      <div className={s.toggleThumb} />
    </div>
  )
}

function CoursePicker({ selected, onChange, label }: { selected: string[]; onChange: (c: string[]) => void; label?: string }) {
  const allSelected = selected.length === 0
  const toggle = (c: string) => onChange(selected.includes(c) ? selected.filter(x => x !== c) : [...selected, c])
  return (
    <div className={s.coursePickerWrap}>
      {label && <span className={s.coursePickerLabel}>{label}</span>}
      <div className={s.coursePicker}>
        <button className={`${s.coursePill} ${allSelected ? s.coursePillSel : ''}`} onClick={e => { e.stopPropagation(); onChange([]) }}>
          All courses
        </button>
        {COURSES.map(c => (
          <button key={c} className={`${s.coursePill} ${selected.includes(c) && !allSelected ? s.coursePillSel : ''}`}
            onClick={e => { e.stopPropagation(); toggle(c) }}>
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function RoutinesModal() {
  const {
    modalOpen, modalView, selectedId, closeModal,
    routines, outputs, addRoutine, toggleRoutine, deleteRoutine,
    markReviewed, markAllReviewed, unreviewedFor,
    openList, openDetail, openBuilder,
  } = useRoutine()

  // Builder — core
  const [step,        setStep]        = useState<1|2|3>(1)
  const [triggerType, setTriggerType] = useState<TriggerType | null>(null)
  const [triggerSub,  setTriggerSub]  = useState<string | null>(null)
  const [selActions,  setSelActions]  = useState<ActionType[]>([])
  const [routineName, setRoutineName] = useState('')
  const [routineEmoji,setRoutineEmoji]= useState('')
  const [emojiOpen,   setEmojiOpen]   = useState(false)

  // Builder — Step 1 trigger config
  const [triggerCourses, setTriggerCourses] = useState<string[]>([])
  const [examDays,       setExamDays]       = useState(3)
  const [customDays,     setCustomDays]     = useState<string[]>([])
  const [customTime,     setCustomTime]     = useState('08:00')
  const [customFreq,     setCustomFreq]     = useState<Freq>('Weekly')

  // Builder — Step 2 action config
  const [actionCourse,   setActionCourse]   = useState<string>('')

  // Builder — Step 3 color
  const [routineColor,   setRoutineColor]   = useState<string>('')

  // Detail state
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())
  const [delConfirm,   setDelConfirm]   = useState(false)

  if (!modalOpen) return null

  const resetBuilder = () => {
    setStep(1); setTriggerType(null); setTriggerSub(null)
    setSelActions([]); setRoutineName(''); setRoutineEmoji(''); setEmojiOpen(false)
    setTriggerCourses([]); setExamDays(3)
    setCustomDays([]); setCustomTime('08:00'); setCustomFreq('Weekly')
    setActionCourse(''); setRoutineColor('')
  }

  const handleOpenBuilder = () => { resetBuilder(); openBuilder() }

  const toggleAction = (a: ActionType) => {
    setSelActions(prev =>
      prev.includes(a) ? prev.filter(x => x !== a) : prev.length < 3 ? [...prev, a] : prev
    )
  }

  const step1Ready = triggerType === 'manual'
    || (triggerType === 'event' && triggerSub !== null)
    || (triggerType === 'schedule' && triggerSub !== null && (triggerSub !== 'custom' || customDays.length > 0))

  const step2Ready = selActions.length > 0

  const handleNext = () => {
    if (step === 1) { setStep(2) }
    else if (step === 2) {
      setRoutineName(autoName(triggerSub, triggerType, selActions))
      setRoutineEmoji(autoEmoji(selActions))
      // Auto-color from course selection
      const course = triggerCourses.length === 1 ? triggerCourses[0] : actionCourse
      setRoutineColor(COURSE_COLORS[course] ?? PALETTE[0])
      setStep(3)
    }
  }

  const handleConfirm = () => {
    if (!routineName.trim() || !triggerType) return
    addRoutine({
      name: (routineName.trim() + ' routine').replace(/\s+routine$/, ' routine'),
      emoji: routineEmoji || autoEmoji(selActions),
      color: routineColor || PALETTE[0],
      triggerType, triggerSub,
      actions: selActions,
      isActive: true,
    })
    closeModal()
    resetBuilder()
  }

  const handleAddTemplate = (t: typeof TEMPLATES[0]) => {
    if (routines.some(r => r.name === t.name)) return
    addRoutine({ name: t.name, emoji: t.emoji, triggerType: t.triggerType, triggerSub: t.triggerSub, actions: t.actions, isActive: true })
  }

  const handleDelete = (id: string) => {
    deleteRoutine(id)
    setDelConfirm(false)
    openList()
  }

  const selectedRoutine = routines.find(r => r.id === selectedId) ?? null
  const routineOutputs  = outputs.filter(o => o.routineId === selectedId)

  const summaryText = triggerType
    ? `${triggerText(triggerType, triggerSub)} → Quill will ${selActions.map(a => ACTIONS.find(x => x.key === a)?.plain ?? a).join(', then ')}.`
    : ''

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  const ListView = (
    <>
      <div className={s.modalHeader}>
        <p className={s.modalEyebrow}>Quill</p>
        <h2 className={s.modalTitle}>Routines</h2>
        <button className={s.closeBtn} onClick={closeModal}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className={s.section}>
        <p className={s.sectionLabel}>My Routines</p>
        {routines.length === 0 ? (
          <p className={s.emptyState}>No routines yet. Create one below.</p>
        ) : routines.map(r => (
          <div key={r.id} className={s.routineRow} onClick={() => openDetail(r.id)}>
            <span className={s.routineEmoji}>{r.emoji}</span>
            <div className={s.routineInfo}>
              <p className={s.routineName}>{r.name}</p>
              <p className={s.routineDesc}>
                {triggerText(r.triggerType, r.triggerSub)} → {r.actions.map(a => ACTIONS.find(x => x.key === a)?.plain).join(', then ')}
              </p>
            </div>
            <Toggle on={r.isActive} onToggle={() => toggleRoutine(r.id)} />
            <svg className={s.chevron} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        ))}

        <button className={s.newBtn} onClick={handleOpenBuilder}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Routine
        </button>
      </div>

      <div className={s.divider} />

      <div className={s.section}>
        <p className={s.sectionLabel}>Templates</p>
        <div className={s.templateGrid}>
          {TEMPLATES.map(t => {
            const exists = routines.some(r => r.name === t.name)
            return (
              <div key={t.name} className={s.templateCard}>
                <div className={s.templateTop}>
                  <span className={s.templateEmoji}>{t.emoji}</span>
                  <p className={s.templateName}>{t.name}</p>
                </div>
                <p className={s.templateDesc}>{t.desc}</p>
                <button
                  className={`${s.addBtn} ${exists ? s.addBtnDone : ''}`}
                  onClick={() => handleAddTemplate(t)}
                  disabled={exists}
                >
                  {exists ? 'Added' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )

  // ── BUILDER VIEW ──────────────────────────────────────────────────────────
  const showActionCourseRow = triggerType === 'schedule' && selActions.includes('summarize')

  const BuilderView = (
    <>
      <div className={s.modalHeader}>
        <button className={s.backBtn} onClick={() => step === 1 ? openList() : setStep(prev => (prev - 1) as 1|2|3)}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className={s.stepIndicator}>
          {([1,2,3] as const).map(n => (
            <div key={n} className={`${s.stepDot} ${step === n ? s.stepDotActive : step > n ? s.stepDotDone : ''}`} />
          ))}
          <span className={s.stepLabel}>Step {step} of 3</span>
        </div>
        <button className={s.closeBtn} onClick={closeModal}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className={s.builderBody}>

        {/* ── Step 1 — Trigger ── */}
        {step === 1 && (
          <>
            <h3 className={s.builderHeading}>When should this run?</h3>
            {([
              { type: 'event'    as TriggerType, icon: '🔔', label: 'When something happens', sub: TRIGGER_EVENTS },
              { type: 'schedule' as TriggerType, icon: '🕐', label: 'On a schedule',           sub: TRIGGER_SCHEDULES },
              { type: 'manual'   as TriggerType, icon: '⚡', label: 'When I ask',              sub: [] },
            ] as const).map(opt => (
              <div key={opt.type}>
                <div
                  className={`${s.triggerCard} ${triggerType === opt.type ? s.triggerCardSel : ''}`}
                  onClick={() => {
                    setTriggerType(opt.type); setTriggerSub(null)
                    setTriggerCourses([]); setExamDays(3)
                    setCustomDays([]); setCustomTime('08:00'); setCustomFreq('Weekly')
                  }}
                >
                  <span className={s.cardIcon}>{opt.icon}</span>
                  <p className={s.cardLabel}>{opt.label}</p>
                  {triggerType === opt.type && <span className={s.cardCheck}>✓</span>}
                </div>

                {/* Sub-pills */}
                {triggerType === opt.type && opt.sub.length > 0 && (
                  <div className={s.subOptions}>
                    {opt.sub.map(sub => (
                      <button
                        key={sub.key}
                        className={`${s.subPill} ${triggerSub === sub.key ? s.subPillSel : ''}`}
                        onClick={e => { e.stopPropagation(); setTriggerSub(sub.key) }}
                      >
                        {sub.key === 'exam_3days' ? `Exam in ${examDays} days` : sub.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Event config area */}
                {triggerType === 'event' && opt.type === 'event' && triggerSub && (
                  <div className={s.configArea}>
                    {triggerSub === 'exam_3days' && (
                      <div className={s.examConfig}>
                        <span className={s.examConfigLabel}>Trigger</span>
                        <div className={s.stepper}>
                          <button className={s.stepperBtn} onClick={e => { e.stopPropagation(); setExamDays(d => Math.max(1, d - 1)) }}>−</button>
                          <span className={s.stepperNum}>{examDays}</span>
                          <button className={s.stepperBtn} onClick={e => { e.stopPropagation(); setExamDays(d => Math.min(30, d + 1)) }}>+</button>
                        </div>
                        <span className={s.examConfigLabel}>days before exam</span>
                      </div>
                    )}
                    <CoursePicker selected={triggerCourses} onChange={setTriggerCourses} />
                  </div>
                )}

                {/* Custom schedule config */}
                {triggerType === 'schedule' && opt.type === 'schedule' && triggerSub === 'custom' && (
                  <div className={s.configArea}>
                    <div className={s.configRow}>
                      <span className={s.configLabel}>Days</span>
                      <div className={s.dayPicker}>
                        {WEEK_DAYS.map(d => (
                          <button
                            key={d}
                            className={`${s.dayBtn} ${customDays.includes(d) ? s.dayBtnSel : ''}`}
                            onClick={e => { e.stopPropagation(); setCustomDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]) }}
                          >
                            {d.slice(0, 2)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={s.configRow}>
                      <span className={s.configLabel}>Time</span>
                      <input
                        type="time"
                        className={s.timeInput}
                        value={customTime}
                        onChange={e => setCustomTime(e.target.value)}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                    <div className={s.configRow}>
                      <span className={s.configLabel}>Repeat</span>
                      <div className={s.freqRow}>
                        {FREQS.map(f => (
                          <button
                            key={f}
                            className={`${s.freqPill} ${customFreq === f ? s.freqPillSel : ''}`}
                            onClick={e => { e.stopPropagation(); setCustomFreq(f) }}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* ── Step 2 — Actions ── */}
        {step === 2 && (
          <>
            <h3 className={s.builderHeading}>What should Quill do?</h3>
            <p className={s.builderSub}>Select up to 3 — they run in order.</p>
            <div className={s.actionGrid}>
              {ACTIONS.map(a => {
                const sel    = selActions.includes(a.key)
                const idx    = selActions.indexOf(a.key)
                const maxed  = !sel && selActions.length >= 3
                return (
                  <div
                    key={a.key}
                    className={`${s.actionCard} ${sel ? s.actionCardSel : ''} ${maxed ? s.actionCardMaxed : ''}`}
                    onClick={() => toggleAction(a.key)}
                  >
                    {sel && <span className={s.actionBadge}>{idx + 1}</span>}
                    <p className={s.actionLabel}>{a.label}</p>
                  </div>
                )
              })}
            </div>

            {/* Summarize course picker for schedule triggers */}
            {showActionCourseRow && (
              <div className={s.actionCourseRow}>
                <span className={s.actionCoursePrefix}>Summarize new content for</span>
                <div className={s.actionCoursePills}>
                  <button
                    className={`${s.coursePill} ${s.coursePillSm} ${actionCourse === '' ? s.coursePillSel : ''}`}
                    onClick={() => setActionCourse('')}
                  >
                    All courses
                  </button>
                  {COURSES.map(c => (
                    <button
                      key={c}
                      className={`${s.coursePill} ${s.coursePillSm} ${actionCourse === c ? s.coursePillSel : ''}`}
                      onClick={() => setActionCourse(c === actionCourse ? '' : c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selActions.length > 0 && (
              <div className={s.actionChain}>
                {selActions.map((a, i) => (
                  <span key={a} className={s.chainItem}>
                    {i > 0 && <span className={s.chainArrow}>→</span>}
                    {ACTIONS.find(x => x.key === a)?.label}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Step 3 — Name + Emoji + Confirm ── */}
        {step === 3 && (
          <>
            <h3 className={s.builderHeading}>Name your routine.</h3>

            {/* Emoji + name + "routine" suffix row */}
            <div className={s.nameRow}>
              {/* Emoji picker */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  className={s.emojiBtn}
                  onClick={() => setEmojiOpen(o => !o)}
                  title="Choose emoji"
                >
                  {routineEmoji || '📝'}
                </button>
                {emojiOpen && (
                  <div className={s.emojiPicker}>
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} className={s.emojiOption} onClick={() => { setRoutineEmoji(e); setEmojiOpen(false) }}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <input
                className={s.nameInput}
                value={routineName}
                onChange={e => setRoutineName(e.target.value)}
                placeholder="Lecture catch-up"
                onKeyDown={e => e.key === 'Enter' && handleConfirm()}
              />
              <span className={s.nameSuffix}>routine</span>
            </div>

            {/* Color picker */}
            <div className={s.colorRow}>
              <span className={s.colorLabel}>Color</span>
              <div className={s.colorSwatches}>
                {PALETTE.map(c => (
                  <button
                    key={c}
                    className={`${s.colorSwatch} ${routineColor === c ? s.colorSwatchSel : ''}`}
                    style={{ background: c }}
                    onClick={() => setRoutineColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {summaryText && <p className={s.summaryText}>{summaryText}</p>}
          </>
        )}
      </div>

      <div className={s.builderFooter}>
        {step < 3 ? (
          <button className={s.nextBtn} onClick={handleNext} disabled={step === 1 ? !step1Ready : !step2Ready}>
            Next →
          </button>
        ) : (
          <button className={s.nextBtn} onClick={handleConfirm} disabled={!routineName.trim()}>
            Create routine
          </button>
        )}
      </div>
    </>
  )

  // ── DETAIL VIEW ──────────────────────────────────────────────────────────
  const DetailView = selectedRoutine ? (
    <>
      <div className={s.modalHeader}>
        <button className={s.backBtn} onClick={openList}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ flex: 1 }} />
        <Toggle on={selectedRoutine.isActive} onToggle={() => toggleRoutine(selectedRoutine.id)} />
        {delConfirm ? (
          <div className={s.delConfirm}>
            <span>Delete?</span>
            <button onClick={() => handleDelete(selectedRoutine.id)} style={{ color: '#D45050' }}>Yes</button>
            <button onClick={() => setDelConfirm(false)}>No</button>
          </div>
        ) : (
          <button className={s.iconBtn} onClick={() => setDelConfirm(true)} title="Delete">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        )}
        <button className={s.closeBtn} onClick={closeModal}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className={s.detailMeta}>
        <span className={s.detailEmoji}>{selectedRoutine.emoji}</span>
        <div>
          <p className={s.detailName}>{selectedRoutine.name}</p>
          <p className={s.detailDesc}>
            {triggerText(selectedRoutine.triggerType, selectedRoutine.triggerSub)} → {selectedRoutine.actions.map(a => ACTIONS.find(x => x.key === a)?.plain).join(', then ')}
          </p>
          <p className={s.detailLast}>
            Last run: {routineOutputs.length ? fmtDate(routineOutputs[0].createdAt) : 'Never run yet'}
          </p>
        </div>
      </div>

      <div className={s.divider} />

      <div className={s.section}>
        <div className={s.feedHeader}>
          <p className={s.sectionLabel}>Output</p>
          {routineOutputs.some(o => !o.reviewedAt) && (
            <button className={s.markAllBtn} onClick={() => markAllReviewed(selectedRoutine.id)}>
              Mark all reviewed
            </button>
          )}
        </div>

        {routineOutputs.length === 0 ? (
          <p className={s.emptyState}>This routine hasn't run yet.</p>
        ) : routineOutputs.map(out => {
          const isExpanded = expanded.has(out.id)
          const isRecall   = out.outputType === 'recall_set'
          let questions: {q:string;a:string}[] = []
          if (isRecall) { try { questions = JSON.parse(out.outputContent) } catch {} }

          return (
            <div key={out.id} className={`${s.outputCard} ${!out.reviewedAt ? s.outputCardNew : ''}`}>
              <div className={s.outputCardHeader}>
                <div className={s.outputMeta}>
                  {!out.reviewedAt && <span className={s.newDot} />}
                  <span className={s.outputTime}>{fmtDate(out.createdAt)}</span>
                  <span className={s.outputType}>{out.outputType.replace('_',' ')}</span>
                </div>
                {isRecall ? (
                  <button className={s.startBtn} onClick={() => {}}>Start →</button>
                ) : (
                  <button
                    className={s.expandBtn}
                    onClick={() => setExpanded(p => { const n = new Set(p); n.has(out.id) ? n.delete(out.id) : n.add(out.id); return n })}
                  >
                    {isExpanded ? 'Collapse ▲' : 'Read ▼'}
                  </button>
                )}
              </div>

              <p className={s.outputTitle}>{out.title}</p>

              {isRecall ? (
                <div className={s.recallList}>
                  {questions.map((q, i) => (
                    <div key={i} className={s.recallItem}>
                      <p className={s.recallQ}>{q.q}</p>
                      <p className={s.recallA}>{q.a}</p>
                    </div>
                  ))}
                </div>
              ) : isExpanded && (
                <p className={s.outputContent}>{out.outputContent}</p>
              )}

              {!out.reviewedAt && (
                <button className={s.reviewedBtn} onClick={() => markReviewed(out.id)}>
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Mark reviewed
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  ) : null

  return (
    <div className={s.overlay} onClick={closeModal}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        {modalView === 'list'    && ListView}
        {modalView === 'builder' && BuilderView}
        {modalView === 'detail'  && DetailView}
      </div>
    </div>
  )
}
