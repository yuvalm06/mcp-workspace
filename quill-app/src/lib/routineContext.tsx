'use client'
import { createContext, useContext, useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriggerType = 'event' | 'schedule' | 'manual'
export type ActionType =
  | 'summarize' | 'recall_set' | 'practice_exam' | 'briefing'
  | 'quiz_weakest' | 'break_down'
  | 'add_study_block' | 'notify'

export type Routine = {
  id:            string
  name:          string
  emoji:         string
  color?:        string          // hex accent color
  triggerType:   TriggerType
  triggerSub:    string | null   // event name or schedule key
  triggerTime?:  string
  actions:       ActionType[]
  isActive:      boolean
  createdAt:     string
}

export type RoutineOutput = {
  id:            string
  routineId:     string
  outputType:    'summary' | 'recall_set' | 'practice_exam' | 'briefing' | 'grade_impact'
  title:         string
  outputContent: string          // text or JSON string
  createdAt:     string
  reviewedAt?:   string
}

export type ModalView = 'list' | 'builder' | 'detail'

// ── Initial data ──────────────────────────────────────────────────────────────

const INIT_ROUTINES: Routine[] = [
  {
    id: 'r1', name: 'Stay caught up', emoji: '📚',
    triggerType: 'event', triggerSub: 'new_lecture',
    actions: ['summarize', 'notify'],
    isActive: true, createdAt: '2026-04-07T09:00:00Z',
  },
  {
    id: 'r2', name: 'Weekly review', emoji: '🔁',
    triggerType: 'schedule', triggerSub: 'every_sunday',
    actions: ['quiz_weakest'],
    isActive: true, createdAt: '2026-04-07T09:00:00Z',
  },
]

const INIT_OUTPUTS: RoutineOutput[] = [
  {
    id: 'o1', routineId: 'r1',
    outputType: 'summary',
    title: 'MECH 241 · Lecture 18 — Pipe Flow',
    outputContent: `Bernoulli's equation applied to internal pipe flow.\n\nKey concepts:\n• Conservation of energy along a streamline: P + ½ρv² + ρgh = constant\n• As pipe cross-section narrows, velocity increases and pressure drops (Venturi effect)\n• Head loss due to friction: h_f = f(L/D)(v²/2g) — Darcy-Weisbach equation\n\nWorked example: Water flows at 2 m/s through a 50 mm pipe that narrows to 25 mm. Find the velocity and pressure change at the narrow section.\n\nWatch out for: Bernoulli only holds for steady, inviscid, incompressible flow along a streamline. Always check Re before applying.`,
    createdAt: '2026-04-13T10:22:00Z',
  },
  {
    id: 'o2', routineId: 'r1',
    outputType: 'summary',
    title: 'MECH 228 · Lecture 16 — Rigid Body Kinematics',
    outputContent: `Relative motion analysis for planar rigid body rotation.\n\nKey equations:\n• v_B = v_A + ω × r_{B/A}\n• a_B = a_A + α × r_{B/A} − ω²r_{B/A}\n\nThe ω²r term is centripetal acceleration — commonly dropped under exam pressure.\n\nPractice: pin-jointed linkage problems where you're given ω of one link and must find v and a of a point on another.`,
    createdAt: '2026-04-12T14:05:00Z',
    reviewedAt: '2026-04-12T18:30:00Z',
  },
  {
    id: 'o3', routineId: 'r2',
    outputType: 'recall_set',
    title: 'Weekly review · Apr 6',
    outputContent: JSON.stringify([
      { q: 'State Bernoulli\'s equation and its three key assumptions.', a: 'P + ½ρv² + ρgh = const. Steady flow, inviscid fluid, incompressible, along a streamline.' },
      { q: 'Second moment of area for a rectangle b×h about its neutral axis?', a: 'I = bh³/12' },
      { q: 'Define Reynolds number and the laminar/turbulent thresholds.', a: 'Re = ρvD/μ. Laminar: Re < 2300. Turbulent: Re > 4000.' },
      { q: 'For a rigid body rotating about a fixed axis, write the velocity of point B relative to A.', a: 'v_B = v_A + ω × r_{B/A}' },
    ]),
    createdAt: '2026-04-06T20:00:00Z',
    reviewedAt: '2026-04-07T09:15:00Z',
  },
]

// ── Context ───────────────────────────────────────────────────────────────────

interface RoutineCtx {
  routines:     Routine[]
  outputs:      RoutineOutput[]
  addRoutine:   (r: Omit<Routine, 'id' | 'createdAt'>) => void
  toggleRoutine:(id: string) => void
  deleteRoutine:(id: string) => void
  markReviewed: (outputId: string) => void
  markAllReviewed:(routineId: string) => void
  unreviewedFor:(routineId: string) => number
  // modal
  modalOpen:    boolean
  modalView:    ModalView
  selectedId:   string | null
  openList:     () => void
  openDetail:   (id: string) => void
  openBuilder:  () => void
  closeModal:   () => void
}

const Ctx = createContext<RoutineCtx>({
  routines: [], outputs: [],
  addRoutine: () => {}, toggleRoutine: () => {}, deleteRoutine: () => {},
  markReviewed: () => {}, markAllReviewed: () => {},
  unreviewedFor: () => 0,
  modalOpen: false, modalView: 'list', selectedId: null,
  openList: () => {}, openDetail: () => {}, openBuilder: () => {}, closeModal: () => {},
})

export function RoutineProvider({ children }: { children: React.ReactNode }) {
  const [routines,  setRoutines]  = useState<Routine[]>(INIT_ROUTINES)
  const [outputs,   setOutputs]   = useState<RoutineOutput[]>(INIT_OUTPUTS)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalView, setModalView] = useState<ModalView>('list')
  const [selectedId,setSelectedId]= useState<string | null>(null)

  const addRoutine = useCallback((r: Omit<Routine, 'id' | 'createdAt'>) => {
    setRoutines(rs => [...rs, { ...r, id: `r${Date.now()}`, createdAt: new Date().toISOString() }])
  }, [])

  const toggleRoutine = useCallback((id: string) =>
    setRoutines(rs => rs.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r)), [])

  const deleteRoutine = useCallback((id: string) =>
    setRoutines(rs => rs.filter(r => r.id !== id)), [])

  const markReviewed = useCallback((outputId: string) =>
    setOutputs(os => os.map(o => o.id === outputId ? { ...o, reviewedAt: new Date().toISOString() } : o)), [])

  const markAllReviewed = useCallback((routineId: string) =>
    setOutputs(os => os.map(o => o.routineId === routineId && !o.reviewedAt ? { ...o, reviewedAt: new Date().toISOString() } : o)), [])

  const unreviewedFor = useCallback((routineId: string) =>
    outputs.filter(o => o.routineId === routineId && !o.reviewedAt).length, [outputs])

  const openList    = () => { setModalView('list');    setModalOpen(true) }
  const openDetail  = (id: string) => { setSelectedId(id); setModalView('detail'); setModalOpen(true) }
  const openBuilder = () => { setModalView('builder'); setModalOpen(true) }
  const closeModal  = () => setModalOpen(false)

  return (
    <Ctx.Provider value={{
      routines, outputs,
      addRoutine, toggleRoutine, deleteRoutine,
      markReviewed, markAllReviewed, unreviewedFor,
      modalOpen, modalView, selectedId,
      openList, openDetail, openBuilder, closeModal,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useRoutine = () => useContext(Ctx)
