'use client'

import { useState } from 'react'
import s from './page.module.css'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Something went wrong'); return }
      window.location.href = '/'
    } catch {
      setError('Could not connect. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={s.page}>
      <div className={s.stars} aria-hidden="true" />
      <div className={s.glow}  aria-hidden="true" />

      {/* Double-bezel outer shell */}
      <div className={s.shell}>
        <div className={s.card}>

          {/* Icon mark */}
          <div className={s.icon} aria-hidden="true">
            <span className={s.iconQ}>Q</span>
          </div>

          <h1 className={s.heading}>Welcome to Quill</h1>
          <p className={s.sub}>
            Enter your email to log in,<br />or <a href="/signup" className={s.subLink}>create an account</a>.
          </p>

          <form className={s.form} onSubmit={handleSubmit} noValidate>
            <div className={s.field}>
              <label className={s.label} htmlFor="email">Your Email</label>
              <input
                id="email"
                type="email"
                className={s.input}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@queensu.ca"
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className={s.input}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && <p className={s.error} role="alert">{error}</p>}

            <button type="submit" className={s.submit} disabled={loading}>
              {loading ? 'Signing in…' : 'Continue'}
            </button>
          </form>

          <p className={s.footer}>
            By clicking Continue, you accept our{' '}
            <a href="#" className={s.footerLink}>Terms of Service</a>
            {' '}and{' '}
            <a href="#" className={s.footerLink}>Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  )
}
