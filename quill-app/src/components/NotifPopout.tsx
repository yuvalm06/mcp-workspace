'use client'
import { useState } from 'react'
import { useNotif } from '@/lib/notifContext'
import s from './NotifPopout.module.css'

export default function NotifPopout() {
  const { isOpen, open, schedClose, questions, answerQuestion } = useNotif()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const setDraft = (id: string, val: string) =>
    setDrafts(d => ({ ...d, [id]: val }))

  const submit = (id: string, val?: string) => {
    const v = val ?? drafts[id]
    if (!v?.trim()) return
    answerQuestion(id, v.trim())
    setDrafts(d => { const n = { ...d }; delete n[id]; return n })
  }

  return (
    <div
      className={`${s.popout} ${isOpen ? s.open : ''}`}
      onMouseEnter={open}
      onMouseLeave={schedClose}
    >
      <div className={s.arrow} />

      <div className={s.header}>
        <span className={s.headerLabel}>From Quill</span>
      </div>

      <div className={s.list}>
        {questions.map(q => (
          <div key={q.id} className={`${s.card} ${q.answered ? s.cardDone : ''}`}>

            {/* Quill message */}
            <div className={s.msgRow}>
              <div className={s.avatar}>Q</div>
              <div className={s.msgBody}>
                <p className={s.msgText}>{q.text}</p>
                <p className={s.msgTime}>{q.time}</p>
              </div>
            </div>

            {/* Response */}
            {q.answered ? (
              <div className={s.answerRow}>
                <p className={s.answerText}>{q.answer}</p>
              </div>
            ) : (
              <div className={s.inputRow}>
                {q.inputType === 'choice' && q.choices?.map(c => (
                  <button key={c} className={s.choiceBtn} onClick={() => submit(q.id, c)}>
                    {c}
                  </button>
                ))}

                {(q.inputType === 'text' || q.inputType === 'date') && (
                  <div className={s.textRow}>
                    <input
                      className={s.textInput}
                      type={q.inputType}
                      placeholder={q.placeholder}
                      value={drafts[q.id] ?? ''}
                      onChange={e => setDraft(q.id, e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submit(q.id)}
                    />
                    <button
                      className={s.sendBtn}
                      disabled={!drafts[q.id]?.trim()}
                      onClick={() => submit(q.id)}
                      aria-label="Send"
                    >
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        ))}
      </div>
    </div>
  )
}
