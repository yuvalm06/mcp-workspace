'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useNotif } from '@/lib/notifContext'
import { useRoutine } from '@/lib/routineContext'
import NotifPopout from './NotifPopout'
import s from './Sidebar.module.css'

const ITEM_H   = 46
const ITEM_GAP = 4

const EVENT_LABELS: Record<string, string> = {
  new_lecture:      'New lecture posted',
  exam_3days:       'Exam in 3 days',
  new_announcement: 'New announcement',
}
const SCHED_LABELS: Record<string, string> = {
  every_morning:  'Every morning',
  every_sunday:   'Every Sunday evening',
  before_lecture: 'Before every lecture',
  custom:         'Custom schedule',
}

const NAV = [
  { href: '/',         label: 'Home',     icon: <HomeIcon /> },
  { href: '/ask',      label: 'Chats',    icon: <ChatIcon /> },
  { href: '/schedule', label: 'Schedule', icon: <CalIcon />  },
]

function getIdx(path: string) {
  if (path === '/') return 0
  if (path.startsWith('/ask')) return 1
  if (path.startsWith('/schedule')) return 2
  return -1
}

function idxToY(i: number) { return i * (ITEM_H + ITEM_GAP) }

type BlobState = { top: number; height: number; phase: 'idle' | 'stretch' | 'snap' }

export default function Sidebar() {
  const path = usePathname()
  const { open, schedClose, unanswered } = useNotif()
  const { routines, openList, openDetail, unreviewedFor } = useRoutine()

  const activeIdx = getIdx(path)
  const targetY   = activeIdx >= 0 ? idxToY(activeIdx) : 0

  const [logoHover,      setLogoHover]      = useState(false)
  const [hoveredRoutine, setHoveredRoutine] = useState<string | null>(null)
  const routineTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const openRoutine  = useCallback((id: string) => { clearTimeout(routineTimer.current); setHoveredRoutine(id) }, [])
  const closeRoutine = useCallback(() => { routineTimer.current = setTimeout(() => setHoveredRoutine(null), 160) }, [])
  const isNewUser = (() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem('quill-first-use')
    if (!stored) { localStorage.setItem('quill-first-use', String(Date.now())); return true }
    return Date.now() - Number(stored) < 24 * 60 * 60 * 1000
  })()
  const logoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const openLogo  = () => { clearTimeout(logoTimer.current); setLogoHover(true) }
  const closeLogo = () => { logoTimer.current = setTimeout(() => setLogoHover(false), 180) }
  const prevYRef = useRef(targetY)
  const [blob, setBlob] = useState<BlobState>({ top: targetY, height: ITEM_H, phase: 'idle' })

  useEffect(() => {
    const prevY = prevYRef.current
    if (targetY === prevY) return

    // Phase 1 — quickly stretch to bridge the gap
    const stretchTop = Math.min(prevY, targetY)
    const stretchH   = Math.abs(targetY - prevY) + ITEM_H
    setBlob({ top: stretchTop, height: stretchH, phase: 'stretch' })

    // Phase 2 — spring-snap to destination (after stretch completes)
    const tid = setTimeout(() => {
      setBlob({ top: targetY, height: ITEM_H, phase: 'snap' })
      prevYRef.current = targetY
    }, 140)

    return () => clearTimeout(tid)
  }, [targetY])

  const blobTransition =
    blob.phase === 'snap'
      ? 'transform 0.52s cubic-bezier(0.22, 1.15, 0.36, 1), height 0.40s cubic-bezier(0.22, 1.15, 0.36, 1)'
      : 'transform 0.14s ease-out, height 0.14s ease-out'

  return (
    <aside className={s.root} style={{
      width: 72,
      background: 'rgba(247,244,239,0.7)',
      borderRight: '0.5px solid rgba(154,146,132,0.25)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '20px 0 18px', gap: 4, flexShrink: 0,
    }}>

      {/* SVG goo filter — hidden */}
      <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        <defs>
          <filter id="goo-nav" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur" type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
          </filter>
        </defs>
      </svg>

      {/* Logo */}
      <div
        className={s.desktopOnly}
        style={{ width: 40, height: 40, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', cursor: 'default' }}
        onMouseEnter={openLogo}
        onMouseLeave={closeLogo}
      >
        <Image src="/logo.svg" alt="Quill" width={40} height={40} />

        {/* How-to popout */}
        <div style={{
          position: 'absolute',
          left: 52,
          top: -6,
          width: 200,
          background: 'rgba(250,248,244,0.98)',
          backdropFilter: 'blur(10px)',
          border: '0.5px solid rgba(154,146,132,0.22)',
          borderRadius: 13,
          boxShadow: '0 12px 40px rgba(24,22,15,0.13), 0 2px 8px rgba(24,22,15,0.06)',
          padding: '14px 16px 16px',
          opacity: logoHover ? 1 : 0,
          pointerEvents: logoHover ? 'auto' : 'none',
          transform: logoHover ? 'translateX(0)' : 'translateX(-6px)',
          transition: 'opacity 0.16s ease-out, transform 0.16s ease-out',
          zIndex: 100,
        }}
        onMouseEnter={openLogo}
        onMouseLeave={closeLogo}
        >
          {/* Arrow */}
          <div style={{
            position: 'absolute', left: -5, top: 18,
            width: 10, height: 10,
            background: 'rgba(250,248,244,0.98)',
            borderLeft: '0.5px solid rgba(154,146,132,0.22)',
            borderBottom: '0.5px solid rgba(154,146,132,0.22)',
            transform: 'rotate(45deg)',
          }} />

          <p style={{ fontFamily: 'var(--f-serif)', fontSize: 16, fontWeight: 300, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 3 }}>
            {isNewUser ? 'New to Quill?' : 'Take the tour'}
          </p>
          <p style={{ fontFamily: 'var(--f-sans)', fontSize: 11, fontWeight: 300, color: 'var(--ink-ghost)', marginBottom: 14, lineHeight: 1.4 }}>
            {isNewUser ? 'Take a quick tour to see what Quill can do for you.' : 'Revisit the walkthrough anytime.'}
          </p>
          <button style={{
            width: '100%',
            fontFamily: 'var(--f-sans)', fontSize: 12, fontWeight: 400,
            color: '#fff',
            background: '#3A5F9E',
            border: 'none', borderRadius: 9,
            padding: '8px 0',
            cursor: 'pointer',
            transition: 'opacity 0.12s',
          }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.82')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Start tour
          </button>
        </div>
      </div>

      {/* Nav group with goo blob */}
      <div className={s.navGroup} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: ITEM_GAP }}>

        {/* Goo blob layer — absolutely positioned behind the links */}
        {activeIdx >= 0 && (
          <div className={s.blob} style={{
            position: 'absolute', inset: 0,
            filter: 'url(#goo-nav)',
            opacity: 0.13,
            pointerEvents: 'none',
            zIndex: 0,
            overflow: 'visible',
          }}>
            <div style={{
              position: 'absolute',
              left: '50%',
              width: ITEM_H,
              top: 0,
              height: blob.height,
              borderRadius: 16,
              background: '#3A5F9E',
              transform: `translateX(-50%) translateY(${blob.top}px)`,
              transition: blobTransition,
              willChange: 'transform, height',
            }} />
          </div>
        )}

        {NAV.map(({ href, label, icon }, i) => {
          const active = i === activeIdx
          return (
            <Link key={href} href={href} title={label} className={s.btn} style={{
              position: 'relative', zIndex: 1,
              width: ITEM_H, height: ITEM_H, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: active ? '#3A5F9E' : '#C4BDB0',
              background: 'transparent',
              textDecoration: 'none',
              flexShrink: 0,
            }}>
              {icon}
            </Link>
          )
        })}
      </div>

      {/* Divider + add — sit below nav with extra breathing room */}
      <div className={s.desktopOnly} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 32, height: 0.5, background: 'rgba(154,146,132,0.25)' }} />
        <div
          className={s.btn}
          title="Routines"
          onClick={openList}
          style={{
            width: 46, height: 46, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#C4BDB0', cursor: 'pointer',
          }}
        >
          <PlusIcon />
        </div>

        {/* Active routine icons */}
        {routines.filter(r => r.isActive).slice(0, 5).map(r => {
          const badge = unreviewedFor(r.id)
          const isHov = hoveredRoutine === r.id
          const accentColor = r.color ?? '#3A5F9E'
          return (
            <div
              key={r.id}
              onClick={() => openDetail(r.id)}
              onMouseEnter={() => openRoutine(r.id)}
              onMouseLeave={closeRoutine}
              style={{
                width: 32, height: 32, borderRadius: 10,
                background: 'rgba(154,146,132,0.10)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', position: 'relative',
                fontSize: 15, lineHeight: 1,
                transition: 'background 0.14s',
              }}
            >
              {r.emoji}
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  width: 12, height: 12, borderRadius: '50%',
                  background: '#D45050', border: '1.5px solid var(--bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--f-sans)', fontSize: 7, fontWeight: 600, color: '#fff',
                }}>{badge}</span>
              )}

              {/* Hover popout */}
              <div
                onMouseEnter={() => openRoutine(r.id)}
                onMouseLeave={closeRoutine}
                style={{
                  position: 'absolute',
                  left: 42, top: '50%',
                  transform: isHov ? 'translateY(-50%) translateX(0)' : 'translateY(-50%) translateX(-6px)',
                  width: 188,
                  background: 'rgba(250,248,244,0.97)',
                  backdropFilter: 'blur(12px)',
                  border: '0.5px solid rgba(154,146,132,0.22)',
                  borderRadius: 11,
                  boxShadow: '0 8px 28px rgba(24,22,15,0.12), 0 2px 8px rgba(24,22,15,0.06)',
                  padding: '10px 12px',
                  opacity: isHov ? 1 : 0,
                  pointerEvents: isHov ? 'auto' : 'none',
                  transition: 'opacity 0.14s ease-out, transform 0.14s ease-out',
                  zIndex: 200,
                }}
              >
                {/* Arrow */}
                <div style={{
                  position: 'absolute', left: -5, top: '50%',
                  width: 9, height: 9,
                  background: 'rgba(250,248,244,0.97)',
                  borderLeft: '0.5px solid rgba(154,146,132,0.22)',
                  borderBottom: '0.5px solid rgba(154,146,132,0.22)',
                  transform: 'translateY(-50%) rotate(45deg)',
                }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <span style={{ fontSize: 16 }}>{r.emoji}</span>
                  <span style={{
                    fontFamily: 'var(--f-sans)', fontSize: 12, fontWeight: 400,
                    color: 'var(--ink)', letterSpacing: '-0.01em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{r.name}</span>
                </div>
                <p style={{
                  fontFamily: 'var(--f-sans)', fontSize: 10.5, fontWeight: 300,
                  color: 'var(--ink-muted)', lineHeight: 1.35, marginBottom: 7,
                  overflow: 'hidden', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {r.triggerType === 'manual'
                    ? 'Runs when you ask'
                    : r.triggerType === 'event'
                      ? EVENT_LABELS[r.triggerSub ?? ''] ?? 'When something happens'
                      : SCHED_LABELS[r.triggerSub ?? ''] ?? 'On a schedule'}
                </p>
                {badge > 0 ? (
                  <span style={{
                    fontFamily: 'var(--f-mono)', fontSize: 9,
                    letterSpacing: '0.05em', textTransform: 'uppercase' as const,
                    color: '#D45050',
                  }}>{badge} unreviewed</span>
                ) : (
                  <span style={{
                    fontFamily: 'var(--f-mono)', fontSize: 9,
                    letterSpacing: '0.05em', textTransform: 'uppercase' as const,
                    color: 'var(--ink-ghost)',
                  }}>All reviewed</span>
                )}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  height: 2, borderRadius: '11px 11px 0 0',
                  background: accentColor, opacity: 0.7,
                }} />
              </div>
            </div>
          )
        })}
      </div>

      <div className={s.spacer} style={{ flex: 1 }} />

      {/* Notification bell */}
      <div
        title="From Quill"
        onMouseEnter={open}
        onMouseLeave={schedClose}
        className={s.btn}
        style={{
          width: 46, height: 46, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#C4BDB0', cursor: 'default', position: 'relative',
        }}
      >
        <BellIcon />
        {unanswered > 0 && (
          <span style={{
            position: 'absolute', top: 7, right: 7,
            width: 14, height: 14, borderRadius: '50%',
            background: '#D45050', border: '1.5px solid var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--f-sans)', fontSize: 8, fontWeight: 500, color: '#fff', lineHeight: 1,
          }}>{unanswered}</span>
        )}
        <NotifPopout />
      </div>

      {/* Settings — separate from nav group so it doesn't get the blob */}
      <Link href="/settings" title="Settings" className={s.btn} style={{
        width: 46, height: 46, borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: path.startsWith('/settings') ? '#3A5F9E' : '#C4BDB0',
        background: path.startsWith('/settings') ? 'rgba(58,95,158,0.10)' : 'transparent',
        textDecoration: 'none',
        flexShrink: 0,
      }}>
        <SettingsIcon />
      </Link>

      {/* Logout */}
      <button
        title="Sign out"
        className={`${s.btn} ${s.desktopOnly}`}
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' })
          window.location.href = '/login'
        }}
        style={{
          width: 46, height: 46, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#C4BDB0', background: 'transparent',
          border: 'none', cursor: 'pointer', flexShrink: 0,
        }}
      >
        <LogoutIcon />
      </button>
    </aside>
  )
}

function HomeIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" /></svg>
}
function ChatIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
}
function CalIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
}
function PlusIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
}
function BellIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
}
function SettingsIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
}
function LogoutIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
}
