'use client'

import { useState } from 'react'
import Link from 'next/link'
import s from './page.module.css'

export default function SignupPage() {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setError('')

    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not create account'); return }
      if (data.confirm) { setCheckEmail(true); return }
      window.location.href = '/'
    } catch {
      setError('Could not connect. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checkEmail) {
    return (
      <div className={s.page}>
        <div className={s.stars} aria-hidden="true" />
        <div className={s.glow}  aria-hidden="true" />
        <div className={s.shell}>
          <div className={s.card}>
            <div className={s.iconEnvelope} aria-hidden="true">
              <svg width="26" height="22" viewBox="0 0 26 22" fill="none">
                <rect x="1" y="1" width="24" height="20" rx="3" stroke="white" strokeOpacity="0.85" strokeWidth="1.5"/>
                <path d="M1 5l12 8 12-8" stroke="white" strokeOpacity="0.85" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 className={s.heading}>Check your inbox</h1>
            <p className={s.sub}>
              We sent a confirmation link to<br />
              <span className={s.emailHighlight}>{email}</span>
            </p>
            <p className={s.confirmNote}>
              Once confirmed,{' '}
              <Link href="/login" className={s.subLink}>sign in here</Link>.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={s.page}>
      <div className={s.stars} aria-hidden="true" />
      <div className={s.glow}  aria-hidden="true" />

      <div className={s.shell}>
        <div className={s.card}>

          <div className={s.icon} aria-hidden="true">
            <span className={s.iconQ}>Q</span>
          </div>

          <h1 className={s.heading}>Create your account</h1>
          <p className={s.sub}>
            Already have one?{' '}
            <Link href="/login" className={s.subLink}>Sign in</Link>.
          </p>

          <form className={s.form} onSubmit={handleSubmit} noValidate>
            <div className={s.field}>
              <label className={s.label} htmlFor="name">Full Name</label>
              <input
                id="name"
                type="text"
                className={s.input}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                required
                autoComplete="name"
                autoFocus
              />
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className={s.input}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@queensu.ca"
                required
                autoComplete="email"
              />
            </div>

            <div className={s.fieldRow}>
              <div className={s.field}>
                <label className={s.label} htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  className={s.input}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className={s.field}>
                <label className={s.label} htmlFor="confirm">Confirm</label>
                <input
                  id="confirm"
                  type="password"
                  className={s.input}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            {error && <p className={s.error} role="alert">{error}</p>}

            <button type="submit" className={s.submit} disabled={loading}>
              {loading ? 'Creating account…' : 'Continue'}
            </button>
          </form>

          <p className={s.footer}>
            By continuing, you accept our{' '}
            <a href="#" className={s.footerLink}>Terms of Service</a>
            {' '}and{' '}
            <a href="#" className={s.footerLink}>Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  )
}
