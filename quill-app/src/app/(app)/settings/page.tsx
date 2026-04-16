'use client'
import { useState, useEffect } from 'react'
import s from './page.module.css'

function useDarkMode() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('quill-dark', next ? '1' : '0') } catch {}
  }

  return { dark, toggle }
}

type SettingRowProps = {
  name: string
  desc: string
  control: React.ReactNode
}

function SettingRow({ name, desc, control }: SettingRowProps) {
  return (
    <div className={s.row}>
      <div className={s.rowInfo}>
        <p className={s.rowName}>{name}</p>
        <p className={s.rowDesc}>{desc}</p>
      </div>
      {control}
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`${s.toggle} ${on ? s.toggleOn : ''}`}
    />
  )
}

function useToggle(initial: boolean) {
  const [on, setOn] = useState(initial)
  return { on, toggle: () => setOn(v => !v) }
}

export default function SettingsPage() {
  const { dark, toggle: toggleDark } = useDarkMode()
  const deadlineReminders  = useToggle(true)
  const studyNudges        = useToggle(true)
  const weeklyDigest       = useToggle(false)
  const citeMaterials      = useToggle(true)
  const autoSuggest        = useToggle(true)

  const [nameInput,   setNameInput]   = useState('')
  const [nameSaving,  setNameSaving]  = useState(false)
  const [nameSaved,   setNameSaved]   = useState(false)

  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => { if (d?.name) setNameInput(d.name) })
  }, [])

  const saveName = async () => {
    if (!nameInput.trim()) return
    setNameSaving(true)
    await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameInput.trim() }),
    })
    setNameSaving(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  return (
    <main className={s.main}>
      <div className={s.heading}>
        <p className={s.eyebrow}>Preferences</p>
        <h1 className={s.title}>Settings</h1>
      </div>

      <section className={s.section}>
        <p className={s.sectionLabel}>Appearance</p>
        <SettingRow
          name="Dark mode"
          desc="Switch to a darker interface for low-light studying"
          control={<Toggle on={dark} onClick={toggleDark} />}
        />
      </section>

      <section className={s.section}>
        <p className={s.sectionLabel}>Notifications</p>
        <SettingRow
          name="Deadline reminders"
          desc="Get notified before assignments and exams are due"
          control={<Toggle on={deadlineReminders.on} onClick={deadlineReminders.toggle} />}
        />
        <SettingRow
          name="Study session nudges"
          desc="Quill suggests study blocks based on your schedule"
          control={<Toggle on={studyNudges.on} onClick={studyNudges.toggle} />}
        />
        <SettingRow
          name="Weekly digest"
          desc="A summary of your week every Sunday evening"
          control={<Toggle on={weeklyDigest.on} onClick={weeklyDigest.toggle} />}
        />
      </section>

      <section className={s.section}>
        <p className={s.sectionLabel}>AI & Responses</p>
        <SettingRow
          name="Cite course materials"
          desc="Quill references specific lecture slides and readings when answering"
          control={<Toggle on={citeMaterials.on} onClick={citeMaterials.toggle} />}
        />
        <SettingRow
          name="Auto-suggest practice"
          desc="Automatically offer quizzes and practice sets near exam dates"
          control={<Toggle on={autoSuggest.on} onClick={autoSuggest.toggle} />}
        />
      </section>

      <section className={s.section}>
        <p className={s.sectionLabel}>Account</p>
        <SettingRow
          name="Your name"
          desc="Used in AI responses, email drafts, and your profile"
          control={
            <div className={s.nameControl}>
              <input
                className={s.nameInput}
                value={nameInput}
                onChange={e => { setNameInput(e.target.value); setNameSaved(false) }}
                onKeyDown={e => e.key === 'Enter' && saveName()}
                placeholder="Your full name"
              />
              <button className={s.nameSaveBtn} onClick={saveName} disabled={nameSaving || !nameInput.trim()}>
                {nameSaved ? 'Saved ✓' : nameSaving ? '…' : 'Save'}
              </button>
            </div>
          }
        />
        <SettingRow
          name="Connected to D2L"
          desc="Syncing courses, grades, and deadlines from your institution"
          control={<span className={s.connectedBadge}>Connected</span>}
        />
      </section>
    </main>
  )
}
