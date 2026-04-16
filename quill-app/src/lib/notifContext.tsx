'use client'
import { createContext, useContext, useState, useCallback, useRef } from 'react'

export type InputType = 'text' | 'date' | 'choice'

export type NotifQuestion = {
  id: string
  text: string
  inputType: InputType
  choices?: string[]
  placeholder?: string
  time: string
  answered?: boolean
  answer?: string
}

const INIT_QUESTIONS: NotifQuestion[] = [
  {
    id: 'q1',
    text: "When's your MECH 241 midterm? I'd like to start building a study plan around it.",
    inputType: 'date',
    time: '10:42 AM',
  },
  {
    id: 'q2',
    text: "Are you more of a morning or evening studier? I'll schedule sessions around your peak focus time.",
    inputType: 'choice',
    choices: ['Morning', 'Evening', 'Both work'],
    time: '9:15 AM',
  },
  {
    id: 'q3',
    text: "How many study hours a day are realistic for you this week?",
    inputType: 'text',
    placeholder: 'e.g. 3 hours',
    time: 'Yesterday',
  },
]

interface NotifCtx {
  isOpen: boolean
  open: () => void
  schedClose: () => void
  questions: NotifQuestion[]
  answerQuestion: (id: string, answer: string) => void
  unanswered: number
}

const Ctx = createContext<NotifCtx>({
  isOpen: false,
  open: () => {},
  schedClose: () => {},
  questions: INIT_QUESTIONS,
  answerQuestion: () => {},
  unanswered: INIT_QUESTIONS.length,
})

export function NotifProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [questions, setQuestions] = useState<NotifQuestion[]>(INIT_QUESTIONS)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const open = useCallback(() => {
    clearTimeout(timer.current)
    setIsOpen(true)
  }, [])

  const schedClose = useCallback(() => {
    timer.current = setTimeout(() => setIsOpen(false), 180)
  }, [])

  const answerQuestion = useCallback((id: string, answer: string) => {
    setQuestions(qs =>
      qs.map(q => q.id === id ? { ...q, answered: true, answer } : q)
    )
  }, [])

  const unanswered = questions.filter(q => !q.answered).length

  return (
    <Ctx.Provider value={{ isOpen, open, schedClose, questions, answerQuestion, unanswered }}>
      {children}
    </Ctx.Provider>
  )
}

export const useNotif = () => useContext(Ctx)
