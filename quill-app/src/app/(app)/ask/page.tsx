'use client'
import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { getCourseColor } from '@/lib/courseColors'
import { filterActiveCourses } from '@/lib/coursePrefs'
import { useUser } from '@/lib/userContext'
import s from './page.module.css'

import type { Block, Source } from '@/app/api/ask/route'
type Message = { role: 'user' | 'quill'; content: string; time: string; sources?: Source[]; blocks?: Block[]; _debug?: any }
type Course = { id: number; name: string; code: string; canAccess?: boolean }

type Thread = {
  id: string
  title: string
  course_id: string | null
  course_code: string | null
  course_name: string | null
  updated_at: string
}

function formatThreadTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return `Today · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  if (diffDays === 1) return `Yesterday · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const GENERIC_SUGGESTED = [
  "Quiz me on this week's material",
  "Summarize today's lecture",
  "What's on my next exam?",
]

const STARTERS = [
  { label: 'Concept review', text: 'Explain the key concepts from this week' },
  { label: 'Practice',       text: 'Quiz me on recent lecture material' },
  { label: 'Lecture notes',  text: 'Summarize what was covered this week' },
  { label: 'Exam prep',      text: 'What topics should I focus on for the exam?' },
]

const SOURCE_TYPE_ICON: Record<string, string> = {
  'LECTURE':       '📄',
  'PAST EXAM':     '📝',
  'TUTORIAL':      '📋',
  'ASSIGNMENT':    '📌',
  'FORMULA SHEET': '📐',
  'LAB':           '🔬',
  'OTHER':         '📄',
}

function formatSourceLabel(src: Source): string {
  const icon = SOURCE_TYPE_ICON[src.sourceType] ?? '📄'
  // Prefer the human-readable title from the content tree
  if (src.title && src.title.trim()) return `${icon} ${src.title.trim()}`
  // Fallback: clean up the filename
  const base = src.filename.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${icon} ${base}`
}

function SourcesRow({ sources }: { sources: Source[] }) {
  if (!sources.length) return null
  const unique = sources.filter((src, i, arr) => arr.findIndex(x => x.filename === src.filename) === i)
  return (
    <div className={s.sourcesRow}>
      <span className={s.sourcesLabel}>SOURCES</span>
      <div className={s.sourcePills}>
        {unique.map((src, i) => (
          <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className={s.sourcePill}>
            {formatSourceLabel(src)}
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Dev debug panel ───────────────────────────────────────────────────────────

function DebugPanel({ debug }: { debug: any }) {
  const [open, setOpen] = useState(false)
  const ok  = '#3a3'
  const err = '#c44'
  const dim = '#888'
  const row = { display: 'flex', gap: 8, fontSize: 11, fontFamily: 'monospace', lineHeight: '1.6' }
  const dot = (color: string) => ({ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 4 })

  return (
    <div style={{ marginTop: 6, borderTop: '0.5px solid rgba(0,0,0,0.08)', paddingTop: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontFamily: 'monospace', fontSize: 10, color: dim, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? '▾' : '▸'} dev · context pipeline
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Session + TOC */}
          <div style={row}><div style={dot(debug.session === 'ok' ? ok : err)} /><span><b>session</b> {debug.session}</span></div>
          <div style={row}><div style={dot(debug.toc?.startsWith('ok') ? ok : err)} /><span><b>toc</b> {debug.toc}</span></div>
          <div style={row}><div style={dot(debug.grades?.includes('items') ? ok : dim)} /><span><b>grades</b> {debug.grades}</span></div>
          <div style={row}><div style={dot(debug.announcements?.includes('items') ? ok : dim)} /><span><b>news</b> {debug.announcements}</span></div>

          {/* All PDFs found */}
          {debug.allPdfs?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ ...row, color: dim }}><b>all PDFs found ({debug.allPdfs.length})</b></div>
              {debug.allPdfs.map((p: any, i: number) => (
                <div key={i} style={{ ...row, color: dim, paddingLeft: 12 }}>
                  <span>[{p.sourceType}] {p.parentTitle} / {p.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* Selected PDFs */}
          {debug.selectedPdfs?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ ...row, color: dim }}><b>selected for context ({debug.selectedPdfs.length})</b></div>
              {debug.selectedPdfs.map((p: any, i: number) => (
                <div key={i} style={{ ...row, paddingLeft: 12 }}>
                  <div style={dot(ok)} /><span>[{p.sourceType}] {p.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* PDF load results */}
          {debug.pdfResults?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ ...row, color: dim }}><b>pdf load results</b></div>
              {debug.pdfResults.map((p: any, i: number) => (
                <div key={i} style={{ ...row, paddingLeft: 12 }}>
                  <div style={dot(p.error ? err : ok)} />
                  <span>
                    {p.title} — {p.error ? `❌ ${p.error}` : `✓ ${p.chars.toLocaleString()} chars${p.cacheHit ? ' (cached)' : ' (downloaded)'}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {debug.contextError && (
            <div style={{ ...row, color: err }}><b>error</b> {debug.contextError}</div>
          )}

          {debug.allPdfs?.length === 0 && debug.toc?.startsWith('ok') && (
            <div style={{ ...row, color: err }}>⚠ TOC loaded but no PDFs found — check URL extensions (.pdf) and folder structure</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Block renderer ────────────────────────────────────────────────────────────

const inlineMd = (isUser: boolean) => ({
  p: ({ children }: any) => <>{children}</>,
  strong: ({ children }: any) => <strong style={{ fontWeight: 600, color: isUser ? '#fff' : 'var(--ink)' }}>{children}</strong>,
})

const richBulletComponents = (sourceMap: Record<string, Source>) => ({
  // Strip wrapping <p> so bullet items flow inline
  p: ({ children }: any) => <span className={s.bulletPara}>{children}</span>,
  strong: ({ children }: any) => <strong className={s.bulletLabel}>{children}</strong>,
  code: ({ children, className }: any) => {
    const isBlock = !!className?.startsWith('language-')
    return isBlock
      ? <code className={s.bulletCode}>{children}</code>
      : <code className={s.bulletInlineCode}>{children}</code>
  },
  pre: ({ children }: any) => <pre className={s.bulletPre}>{children}</pre>,
  a: ({ href, children }: any) => {
    if (!href) return <a href="#" className={s.bulletSlideLink}>{children}</a>
    const [base, hash] = href.split('#')
    const src = sourceMap[base]
    const resolved = src ? `${src.url}${hash ? `#${hash}` : ''}` : href
    return (
      <a href={resolved} target="_blank" rel="noopener noreferrer" className={s.bulletSlideLink}>
        {children}
      </a>
    )
  },
})

function QuestionBlock({ block, qNum, sourceMap, isUser }: { block: Extract<Block, { type: 'question' }>; qNum: number; sourceMap: Record<string, Source>; isUser: boolean }) {
  const [showSolution, setShowSolution] = useState(false)
  const src = block.cite ? sourceMap[block.cite] : null
  const isReal = block.origin === 'real'
  return (
    <div className={s.blockQuestionWrap}>
      <p className={s.blockQuestionLabel}>{isReal ? 'From your materials ✦' : 'Quick check ✦'}</p>
      <div className={`${s.blockQuestion} ${isReal ? s.blockQuestionReal : ''}`}>
        <span className={s.blockQuestionNum}>{qNum}</span>
        <div className={s.blockQuestionBody}>
          {isReal && src && (
            <a href={src.url} target="_blank" rel="noopener noreferrer" className={s.blockQuestionRealTag}>
              {SOURCE_TYPE_ICON[src.sourceType] ?? '📄'} {src.title || src.filename}
            </a>
          )}
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents(isUser)}>
            {normalizeMath(block.text)}
          </ReactMarkdown>
          {!isReal && src && (
            <a href={src.url} target="_blank" rel="noopener noreferrer" className={s.blockQuestionSlide}>
              View source →
            </a>
          )}
          {block.solution && block.solution.length > 0 && (
            <div className={s.solutionWrap}>
              <button className={s.solutionToggle} onClick={() => setShowSolution(v => !v)}>
                <span className={`${s.solutionChevron} ${showSolution ? s.solutionChevronOpen : ''}`}>›</span>
                {showSolution ? 'Hide solution' : 'Show solution'}
              </button>
              {showSolution && (
                <div className={s.solutionSteps}>
                  {block.solution.map((step, k) => (
                    <div key={k} className={s.solutionStep}>
                      <span className={s.solutionStepNum}>{k + 1}</span>
                      <div className={s.solutionStepContent}>
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents(isUser)}>
                          {normalizeMath(step)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BlockRenderer({ blocks, sourceMap, isUser, onChoice, isLatest }: { blocks: Block[]; sourceMap: Record<string, Source>; isUser: boolean; onChoice?: (text: string) => void; isLatest?: boolean }) {
  let qNum = 0
  return (
    <div className={s.blocks}>
      {blocks.map((block, i) => {
        if (block.type === 'summary') {
          return (
            <div key={i} className={s.blockSummary}>
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents(isUser)}>
                {normalizeMath(block.text)}
              </ReactMarkdown>
            </div>
          )
        }
        if (block.type === 'bullets') {
          const bulletMd = richBulletComponents(sourceMap)
          return (
            <ul key={i} className={s.blockBullets}>
              {block.items.map((item, j) => (
                <li key={j} className={s.blockBulletItem}>
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={bulletMd}>
                    {normalizeMath(item)}
                  </ReactMarkdown>
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === 'highlight') {
          return (
            <div key={i} className={s.blockHighlight}>
              <span className={s.blockHighlightIcon}>✦</span>
              <div className={s.blockHighlightText}>
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={inlineMd(isUser)}>
                  {normalizeMath(block.text)}
                </ReactMarkdown>
              </div>
            </div>
          )
        }
        if (block.type === 'steps') {
          let stepNum = 0
          const stepMd = richBulletComponents(sourceMap)
          return (
            <div key={i} className={s.blockSteps}>
              {block.label && <p className={s.blockStepsLabel}>{block.label}</p>}
              <div className={s.blockStepsList}>
                {block.items.map((item, j) => {
                  // Group step: item has a sub-list (newline followed by - or *)
                  const isGroup = /\n[-*] /.test(item.trim())
                  if (isGroup) {
                    const nl = item.indexOf('\n')
                    const labelPart = nl > -1 ? item.slice(0, nl).trim() : item
                    const restPart  = nl > -1 ? item.slice(nl).trim()   : ''
                    return (
                      <div key={j} className={s.blockStepGroup}>
                        <div className={s.blockStepGroupLabel}>
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={stepMd}>
                            {normalizeMath(labelPart)}
                          </ReactMarkdown>
                        </div>
                        {restPart && (
                          <div className={s.blockStepSubItems}>
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={stepMd}>
                              {normalizeMath(restPart)}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )
                  }
                  stepNum++
                  return (
                    <div key={j} className={s.blockStepItem}>
                      <span className={s.blockStepNum}>{stepNum}</span>
                      <div className={s.blockStepContent}>
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={stepMd}>
                          {normalizeMath(item)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }
        if (block.type === 'choice') {
          // Only render choices on the most recent Quill message — stale options on old messages are confusing
          if (!isLatest || !onChoice) return null
          return (
            <div key={i} className={s.blockChoices}>
              {block.items.map((item, j) => (
                <button key={j} className={s.blockChoiceBtn} onClick={() => onChoice(item)}>
                  {item}
                </button>
              ))}
            </div>
          )
        }
        if (block.type === 'question') {
          qNum++
          return <QuestionBlock key={i} block={block} qNum={qNum} sourceMap={sourceMap} isUser={isUser} />
        }
        return null
      })}
    </div>
  )
}

// Normalize math delimiters only (citations handled by splitting below)
function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`)
}

const mdComponents = (isUser: boolean) => ({
  p: ({ children }: any) => <p style={{ margin: '0 0 8px', lineHeight: 1.6 }}>{children}</p>,
  ul: ({ children }: any) => <ul style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }: any) => <li style={{ marginBottom: 4, lineHeight: 1.6 }}>{children}</li>,
  strong: ({ children }: any) => <strong style={{ fontWeight: 600, color: isUser ? '#fff' : 'var(--ink)' }}>{children}</strong>,
  code: ({ children }: any) => <code style={{ fontFamily: 'var(--f-mono)', fontSize: 12, background: isUser ? 'rgba(255,255,255,0.15)' : 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{children}</code>,
  pre: ({ children }: any) => <pre style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 12px', overflowX: 'auto', margin: '8px 0', fontSize: 12 }}>{children}</pre>,
})

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents(isUser)}>
      {normalizeMath(content)}
    </ReactMarkdown>
  )
}

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function AskPageInner() {
  const searchParams  = useSearchParams()
  const router        = useRouter()
  const courseId      = searchParams.get('course')
  const { initials }  = useUser()

  const [course,      setCourse]      = useState<Course | null>(null)
  const [courseColorIdx, setCourseColorIdx] = useState(0)
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [loading,      setLoading]      = useState(false)
  const [threadSearch, setThreadSearch] = useState('')
  const [confOpen,     setConfOpen]     = useState(false)
  const [liveSuggestions, setLiveSuggestions] = useState<string[]>([])
  const [suggestLoading,  setSuggestLoading]  = useState(false)
  const [threads,      setThreads]      = useState<Thread[]>([])
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const [courseList,    setCourseList]    = useState<Course[]>([])
  const [onqConnected,  setOnqConnected]  = useState<boolean | null>(null) // null = still loading
  const bottomRef       = useRef<HTMLDivElement>(null)
  const loadingThreadRef = useRef(false)

  // Load thread list and course list on mount
  useEffect(() => {
    fetch('/api/threads')
      .then(r => r.ok ? r.json() : [])
      .then((data: Thread[]) => { if (Array.isArray(data)) setThreads(data) })
      .catch(() => {})
    fetch('/api/courses')
      .then(r => r.ok ? r.json() : [])
      .then((courses: Course[]) => {
        const active = filterActiveCourses(Array.isArray(courses) && courses.length ? courses : [])
        setCourseList(active)
        setOnqConnected(active.length > 0)
      })
      .catch(() => { setCourseList([]); setOnqConnected(false) })
  }, [])

  // Reset conversation and drawer when course changes (skip if triggered by loadThread)
  useEffect(() => {
    if (loadingThreadRef.current) return
    setMessages([])
    setInput('')
    setConfOpen(false)
    setLiveSuggestions([])
    setActiveThread(null)
    if (!courseId) { setCourse(null); return }
    fetch('/api/courses')
      .then(r => r.json())
      .then((courses: Course[]) => {
        const list = filterActiveCourses(Array.isArray(courses) ? courses : [])
        setCourseList(list)
        const idx  = list.findIndex(c => String(c.id) === courseId)
        setCourse(idx >= 0 ? list[idx] : null)
        setCourseColorIdx(idx >= 0 ? idx : 0)
      })
      .catch(() => {
        setCourseList([])
        setCourse(null)
      })
  }, [courseId])

  const loadThread = async (thread: Thread) => {
    loadingThreadRef.current = true
    setActiveThread(thread.id)
    setMessages([])
    setLiveSuggestions([])

    // Set course context directly from thread metadata (no URL change needed)
    if (thread.course_id && thread.course_code) {
      const list = courseList
      const idx = list.findIndex(c => c.code === thread.course_code)
      setCourse({
        id:   Number(thread.course_id),
        code: thread.course_code,
        name: thread.course_name ?? '',
      })
      setCourseColorIdx(idx >= 0 ? idx : 0)
    } else {
      setCourse(null)
    }

    try {
      const res  = await fetch(`/api/threads/${thread.id}`)
      const data = await res.json()
      if (!Array.isArray(data.messages)) return
      const restored: Message[] = data.messages.map((m: any) => ({
        role:    m.role as 'user' | 'quill',
        content: m.content,
        time:    new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        blocks:  m.blocks ?? undefined,
        sources: m.sources ?? undefined,
      }))
      setMessages(restored)
    } catch {}

    loadingThreadRef.current = false
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const fetchSuggestions = async (updatedMessages: Message[]) => {
    setSuggestLoading(true)
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, courseCode: course?.code ?? null }),
      })
      const data = await res.json()
      if (Array.isArray(data.suggestions) && data.suggestions.length) {
        setLiveSuggestions(data.suggestions)
      }
    } catch {}
    setSuggestLoading(false)
  }

  const send = async (text?: string) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')
    const time = nowTime()
    const nextMessages: Message[] = [...messages, { role: 'user', content: userMsg, time }]
    setMessages(nextMessages)
    setLoading(true)
    try {
      const res  = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history: messages,
          courseId: course?.id ?? null,
          courseCode: course?.code ?? null,
          courseName: course?.name ?? null,
        }),
      })
      let data: any = {}
      try { data = await res.json() } catch { /* non-JSON response */ }
      if (!res.ok) console.error('[ask] API error', res.status, data)
      const reply = data.reply ?? (res.ok ? 'Sorry, I had trouble responding.' : `Error ${res.status} — please try again.`)
      const quillMsg: Message = { role: 'quill', content: reply, time: nowTime(), sources: data.sources ?? [], blocks: data.blocks ?? undefined, _debug: data._debug }
      const withReply: Message[] = [...nextMessages, quillMsg]
      setMessages(withReply)
      fetchSuggestions(withReply)

      // Persist to Supabase
      const newPair = [
        { role: 'user',  content: userMsg },
        { role: 'quill', content: reply, blocks: data.blocks ?? null, sources: data.sources ?? null },
      ]
      if (!activeThread) {
        // First message — create thread
        const tres = await fetch('/api/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            courseId:   course?.id   ?? null,
            courseCode: course?.code ?? null,
            courseName: course?.name ?? null,
            messages:   newPair,
          }),
        })
        if (tres.ok) {
          const { id } = await tres.json()
          setActiveThread(id)
          // Prepend new thread to list
          const newThread: Thread = {
            id,
            title:       userMsg.slice(0, 80),
            course_id:   course?.id   ? String(course.id) : null,
            course_code: course?.code ?? null,
            course_name: course?.name ?? null,
            updated_at:  new Date().toISOString(),
          }
          setThreads(prev => [newThread, ...prev])
        }
      } else {
        // Append to existing thread
        fetch(`/api/threads/${activeThread}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: newPair }),
        }).then(() => {
          // Bump thread to top of list
          setThreads(prev => {
            const updated = prev.map(t => t.id === activeThread ? { ...t, updated_at: new Date().toISOString() } : t)
            return [updated.find(t => t.id === activeThread)!, ...updated.filter(t => t.id !== activeThread)]
          })
        }).catch(() => {})
      }
    } catch {
      setMessages(prev => [...prev, { role: 'quill', content: 'Sorry, something went wrong.', time: nowTime() }])
    }
    setLoading(false)
  }

  const inConversation = messages.length > 0
  const placeholder    = course ? `Ask anything about ${course.code}…` : 'Ask anything about your courses…'

  // Static defaults — replaced by live suggestions once the conversation starts
  const defaultSuggested = course
    ? STARTERS.map(st => st.text)
    : GENERIC_SUGGESTED
  const suggested = liveSuggestions.length > 0 ? liveSuggestions : defaultSuggested

  return (
    <div className={s.wrap}>

      {/* ── Chat column ── */}
      <div className={s.main}>

        {/* Topbar */}
        <div className={s.topbar}>
          <div>
            {course ? (
              <>
                <p className={s.topbarCourse}>{course.code}</p>
                <p className={s.topbarTitle}>{course.name}</p>
              </>
            ) : (
              <>
                <p className={s.topbarTitle}>Ask Quill</p>
                <p className={s.topbarSub}>Today · {messages.length} message{messages.length !== 1 ? 's' : ''}</p>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {course && (
              <button
                className={`${s.confBtn} ${confOpen ? s.confBtnActive : ''}`}
                onClick={() => setConfOpen(o => !o)}
              >
                Confidence
              </button>
            )}
            {inConversation && (
              <button className={s.topbarNew} onClick={() => { setMessages([]); setActiveThread(null); setLiveSuggestions([]) }}>+ New thread</button>
            )}
          </div>
        </div>

        {/* Confidence drawer — overlays from right inside chat column */}
        <div className={`${s.confDrawer} ${confOpen ? s.confDrawerOpen : ''}`}>
          <div className={s.confHeader}>Weekly Confidence</div>
          <div className={s.confList}>
            {Array.from({ length: 12 }, (_, i) => (
              <button
                key={i}
                className={s.confWeek}
                onClick={() => { setInput(v => v ? `${v} [Week ${i + 1}]` : `[Week ${i + 1}] `); setConfOpen(false) }}
              >
                <span className={s.confWeekLabel}>Week {i + 1}</span>
                <span className={s.confDots}>
                  {[0,1,2,3].map(d => <span key={d} className={s.confDot} />)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Thread / empty state */}
        <div className={s.thread} onClick={() => confOpen && setConfOpen(false)}>

          {/* Course landing — empty state with 2×2 grid */}
          {!inConversation && course && (
            <div className={s.emptyState}>
              <div className={s.emptyHeadline}>
                <p className={s.emptyEyebrow}>{course.code} · {course.name}</p>
                <h2 className={s.emptyTitle}>
                  What would you like to<br /><em>explore today?</em>
                </h2>
              </div>
              <div className={s.starterGrid}>
                {STARTERS.map(st => (
                  <button key={st.label} className={s.starterBtn} onClick={() => send(st.text)}>
                    <p className={s.starterLabel}>{st.label}</p>
                    <p className={s.starterText}>{st.text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Not connected — prompt to install extension */}
          {!inConversation && !course && onqConnected === false && (
            <div className={s.connectState}>
              <div className={s.connectIcon}>Q</div>
              <h2 className={s.connectTitle}>Connect your OnQ account</h2>
              <p className={s.connectDesc}>
                Quill reads your real course materials, grades, and announcements directly from OnQ.
                Install the Chrome extension to get started.
              </p>
              <a
                href="https://chromewebstore.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className={s.connectBtn}
              >
                Install Chrome Extension
              </a>
              <p className={s.connectSub}>After installing, visit OnQ and the extension will connect automatically.</p>
            </div>
          )}

          {/* Generic landing — connected but no course selected */}
          {!inConversation && !course && onqConnected === true && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <p className={s.emptyLabel}>Suggested</p>
              {GENERIC_SUGGESTED.map(t => (
                <button key={t} className={s.emptyBtn} onClick={() => send(t)}>{t}</button>
              ))}
            </div>
          )}

          {/* Messages */}
          {messages.map((m, i) => (
            <div key={i} className={`${s.msgRow} ${m.role === 'user' ? s.msgRowUser : ''}`}>
              <div className={`${s.avatar} ${m.role === 'user' ? s.avatarUser : s.avatarQuill}`}>
                {m.role === 'user' ? initials : 'Q'}
              </div>
              <div className={`${s.bubble} ${m.role === 'quill' ? s.bubbleWide : ''}`}>
                <div className={`${s.bubbleBody} ${m.role === 'user' ? s.bubbleBodyUser : s.bubbleBodyQuill}`}>
                  <div className={`${s.bubbleText} ${m.role === 'user' ? s.bubbleTextUser : ''}`}>
                    {m.role === 'quill' && m.blocks ? (
                      <BlockRenderer
                        blocks={m.blocks}
                        sourceMap={Object.fromEntries((m.sources ?? []).map(src => [src.filename, src]))}
                        isUser={false}
                        isLatest={i === messages.length - 1}
                        onChoice={(text) => send(text)}
                      />
                    ) : (
                      <MessageContent content={m.content} isUser={m.role === 'user'} />
                    )}
                  </div>
                </div>
                {m.role === 'quill' && m.sources && m.sources.length > 0 && (
                  <SourcesRow sources={m.sources} />
                )}
                {m.role === 'quill' && m._debug && <DebugPanel debug={m._debug} />}
                <p className={s.bubbleTime}>{m.time}</p>
              </div>
            </div>
          ))}

          {loading && (
            <div className={s.typingRow}>
              <div className={`${s.avatar} ${s.avatarQuill}`}>Q</div>
              <div className={s.typingBubble}>
                <div className={s.typingDots}>
                  <div className={s.typingDot} /><div className={s.typingDot} /><div className={s.typingDot} />
                </div>
                <p className={s.typingLabel}>Quill is writing…</p>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Course chips — only in general chat */}
        {!course && (
          <div className={s.courseChips}>
            <button className={`${s.courseChip} ${s.courseChipQuill}`} onClick={() => router.push('/ask')}>
              Ask Quill
            </button>
            {courseList.map((c, i) => {
              const color = getCourseColor(i)
              return (
                <button
                  key={c.id}
                  className={s.courseChip}
                  style={{ background: color.tint, color: color.accent }}
                  onClick={() => router.push(`/ask?course=${c.id}`)}
                >
                  Ask {c.code}
                </button>
              )
            })}
          </div>
        )}

        {/* Input bar */}
        <div className={s.inputWrap}>
          <div className={s.inputBar}>
            <input
              className={s.inputField}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder={placeholder}
            />
            <div className={s.inputActions}>
              {course && (
                <span
                  className={s.inputPill}
                  style={{
                    background: getCourseColor(courseColorIdx).tint,
                    color:      getCourseColor(courseColorIdx).accent,
                    border:     'none',
                  }}
                >
                  {course.code}
                </span>
              )}
              <span className={s.inputPill}>+ context</span>
              <button className={s.sendBtn} onClick={() => send()} disabled={loading || !input.trim()} aria-label="Send message">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={s.rightPanel}>
        <div className={s.panelSection}>
          <p className={s.panelLabel}>Chats</p>
          <div className={s.threadSearch}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className={s.threadSearchInput}
              placeholder="Search chats…"
              value={threadSearch}
              onChange={e => setThreadSearch(e.target.value)}
            />
          </div>
          <div className={s.threadList}>
            {threads
              .filter(t => {
                const q = threadSearch.toLowerCase()
                return !q || (t.course_code ?? '').toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
              })
              .map((t, i) => {
                const courseIdx = courseList.findIndex(c => c.code === t.course_code)
                const c = getCourseColor(courseIdx >= 0 ? courseIdx : 0)
                return (
                  <div
                    key={t.id}
                    className={`${s.threadItem} ${activeThread === t.id ? s.threadItemActive : ''}`}
                    onClick={() => loadThread(t)}
                  >
                    {t.course_code && (
                      <span className={s.threadCourseTag} style={{ background: c.tint, color: c.accent }}>
                        {t.course_code}
                      </span>
                    )}
                    <p className={s.threadTopic}>{t.title}</p>
                    <p className={s.threadTime}>{formatThreadTime(t.updated_at)}</p>
                  </div>
                )
              })}
            {threads.length === 0 && (
              <p className={s.threadEmpty}>No chats yet</p>
            )}
          </div>
        </div>
        <div className={s.panelDivider} />
        <div>
          <div className={s.suggestLabelRow}>
            <p className={s.panelLabel}>Suggested</p>
            {suggestLoading && <span className={s.suggestSpinner} />}
          </div>
          <div className={s.suggestList}>
            {suggestLoading && liveSuggestions.length === 0
              ? [0,1,2].map(i => <div key={i} className={s.suggestSkeleton} />)
              : suggested.map((text, i) => (
                  <button key={i} className={s.suggestItem} onClick={() => send(text)}>
                    <p className={s.suggestText}>{text}</p>
                  </button>
                ))
            }
          </div>
        </div>
      </div>

    </div>
  )
}

export default function AskPage() {
  return (
    <Suspense>
      <AskPageInner />
    </Suspense>
  )
}
