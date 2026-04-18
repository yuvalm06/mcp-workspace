import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import { D2L_API, getD2LSession, d2lGet } from '@/lib/d2l'

export const maxDuration = 60

// Keywords that suggest a content section may contain exam/assessment dates.
// Applied to topic title + IMMEDIATE parent module only — not grandparents —
// to avoid false positives from unrelated policy/schedule modules.
const EXAM_TOPIC_RE = /exam|final|midterm|assessment|important\s+date|course\s+info|syllabus/i

// Secondary: broader keywords only applied to topic title alone (not inherited)
const EXAM_TITLE_ONLY_RE = /test|quiz|schedule/i

interface ContentSection {
  title: string
  parentTitle: string
  url: string | null   // null when source is a module description
  inlineText: string | null // non-null when source is a module description
}

/**
 * Walk the D2L content TOC and return:
 *   (a) Module descriptions for modules whose title matches exam keywords
 *   (b) HTML topic pages whose title or immediate parent folder matches exam keywords
 * PDFs are skipped. Grandparent titles are NOT used to avoid false positives.
 */
function findExamContentTopics(modules: any[]): ContentSection[] {
  const results: ContentSection[] = []
  for (const mod of modules) {
    const modTitle: string = mod.Title || mod.title || ''

    // (a) Module description — only if module title itself matches
    if (EXAM_TOPIC_RE.test(modTitle)) {
      const html: string = mod.Description?.Html || mod.Description?.Text || ''
      if (html.length > 20) {
        results.push({ title: modTitle, parentTitle: '', url: null, inlineText: html })
      }
    }

    // (b) Topics inside this module — match on topic title + immediate parent
    for (const topic of (mod.Topics || mod.topics || [])) {
      const topicTitle: string = topic.Title || topic.title || ''
      const topicUrl: string   = topic.Url   || topic.url   || ''
      if (!topicUrl) continue
      if (topicUrl.toLowerCase().endsWith('.pdf')) continue
      const combined = `${topicTitle} ${modTitle}`
      if (EXAM_TOPIC_RE.test(combined) || EXAM_TITLE_ONLY_RE.test(topicTitle)) {
        results.push({ title: topicTitle, parentTitle: modTitle, url: topicUrl, inlineText: null })
      }
    }

    // Recurse — do NOT pass parentTitle to avoid grandparent keyword bleeding
    results.push(...findExamContentTopics(mod.Modules || mod.modules || []))
  }
  return results
}

/**
 * POST /api/sync-exams
 * Body: { courses: { id: number, code: string, name: string }[], since?: string (ISO) }
 *
 * Fetches (a) instructor announcements and (b) exam-related content text pages
 * for each course. Sends both to Claude to extract exam/test/quiz/midterm dates,
 * then inserts new ones into the exams table.
 *
 * For announcements: `since` is passed to D2L server-side so only new/updated items
 * are returned. Content pages are always scanned (small subset, title-filtered).
 *
 * Deduplicates by (user_id, course_id, title, exam_date) — safe to call repeatedly.
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { courses, since } = await req.json()
  if (!Array.isArray(courses) || courses.length === 0) {
    return NextResponse.json({ synced: 0, message: 'no courses provided' })
  }

  const d2l = await getD2LSession(user.id)
  if (!d2l) return NextResponse.json({ synced: 0, message: 'no D2L session' })

  // D2L supports ?since=ISO8601 to return only new/updated announcements
  const sinceParam = since ? `?since=${encodeURIComponent(since)}` : ''

  const sections: string[] = []

  // ── 1. Announcements ────────────────────────────────────────────────────────
  await Promise.all(
    courses.map(async (course: { id: number; code: string; name: string }) => {
      try {
        const news = await d2lGet(d2l, `/d2l/api/le/${D2L_API}/${course.id}/news/${sinceParam}`)
        if (!Array.isArray(news) || news.length === 0) return
        for (const item of news.slice(0, 30)) {
          const body = (item.Body?.Text || item.Body?.Html || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1200)
          console.log(`[sync-exams] announcement: [${course.code}] "${item.Title}" (posted ${item.CreatedDate || 'unknown'})`)
          sections.push(
            `COURSE_CODE: ${course.code}\nCOURSE_ID: ${course.id}\nSOURCE: announcement\nTITLE: ${item.Title || ''}\nPOSTED: ${item.CreatedDate || ''}\nBODY: ${body}`
          )
        }
      } catch (err: any) {
        console.error(`[sync-exams] announcement fetch failed for course ${course.id}:`, err?.message)
      }
    })
  )

  // ── 2. Content text pages (exam-keyword-filtered) ───────────────────────────
  await Promise.all(
    courses.map(async (course: { id: number; code: string; name: string }) => {
      try {
        const toc = await d2lGet(d2l, `/d2l/api/le/${D2L_API}/${course.id}/content/toc`)
        if (!toc) return
        const modules: any[] = toc.Modules || toc.modules || []
        const examTopics = findExamContentTopics(modules).slice(0, 8) // max 8 per course
        for (const topic of examTopics) {
          try {
            let rawText = ''

            if (topic.inlineText !== null) {
              // Module description — already have the HTML inline
              rawText = topic.inlineText
            } else if (topic.url) {
              const fullUrl = topic.url.startsWith('http')
                ? topic.url
                : `https://${d2l.host}${topic.url}`
              const res = await fetch(fullUrl, {
                headers: { Cookie: d2l.cookieHeader },
                redirect: 'follow',
              })
              if (!res.ok) continue
              const ct = res.headers.get('content-type') || ''
              if (!ct.includes('text/html') && !ct.includes('text/plain')) continue
              rawText = await res.text()
            }

            const text = rawText
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 2000)

            if (text.length < 50) continue
            const src = topic.inlineText !== null ? 'module description' : 'content page'
            console.log(`[sync-exams] ${src}: [${course.code}] "${topic.title}"${topic.parentTitle ? ` in folder "${topic.parentTitle}"` : ''} — preview: ${text.slice(0, 150).replace(/\n/g, ' ')}`)
            sections.push(
              `COURSE_CODE: ${course.code}\nCOURSE_ID: ${course.id}\nSOURCE: ${src}\nFOLDER: ${topic.parentTitle}\nTITLE: ${topic.title}\nBODY: ${text}`
            )
          } catch (err: any) {
            console.error(`[sync-exams] content fetch failed for [${course.code}] "${topic.title}":`, err?.message)
          }
        }
      } catch (err: any) {
        console.error(`[sync-exams] TOC fetch failed for course ${course.id}:`, err?.message)
      }
    })
  )

  if (sections.length === 0) {
    return NextResponse.json({ synced: 0, message: 'no content found to scan' })
  }

  // ── 3. Claude extraction ────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const prompt = `Today is ${today}. Read the following course content (announcements and content pages) and extract every upcoming exam, test, midterm, quiz, final, or graded assessment that has a specific date mentioned.

Return a JSON array. Each item must have:
- "courseCode": exactly as shown in COURSE_CODE (e.g. "MECH 241")
- "courseId": exactly as shown in COURSE_ID (numeric)
- "title": concise name like "Midterm 1", "Quiz 2", "Final Exam", "Lab Test", "Term Test 1"
- "date": ISO date (YYYY-MM-DD). If only a weekday or vague time is given with no actual calendar date, skip it.

Return ONLY a raw JSON array with no code fences or explanation. If nothing found, return [].

CONTENT:
${sections.join('\n\n---\n\n')}`

  let events: { courseCode: string; courseId: number; title: string; date: string }[] = []
  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-5-haiku',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const aiData = await aiRes.json()
    const raw = (aiData.choices?.[0]?.message?.content || '[]').trim()
      .replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) events = parsed
    console.log(`[sync-exams] Claude extracted ${events.length} event(s):`, JSON.stringify(events))
  } catch (err: any) {
    console.error('[sync-exams] Claude extraction failed:', err?.message)
    return NextResponse.json({ synced: 0, error: 'AI extraction failed' }, { status: 500 })
  }

  // ── 4. Filter to future events with valid dates ─────────────────────────────
  const now = new Date()
  const validEvents = events.filter(e => {
    if (!e.title || !e.courseCode || !e.courseId || !e.date) return false
    const d = new Date(e.date)
    return !isNaN(d.getTime()) && d > now
  })

  if (validEvents.length === 0) {
    return NextResponse.json({ synced: 0, message: 'no upcoming exam dates found' })
  }

  // ── 5. Dedup + insert ───────────────────────────────────────────────────────
  const sb = supabaseServer()
  const { data: existing } = await sb
    .from('exams')
    .select('course_id, title, exam_date')
    .eq('user_id', user.id)

  const existingKeys = new Set(
    (existing || []).map((e: any) => `${e.course_id}|${e.title}|${e.exam_date?.split('T')[0]}`)
  )

  const toInsert = validEvents
    .filter(e => !existingKeys.has(`${e.courseId}|${e.title}|${e.date}`))
    .map(e => ({
      user_id:     user.id,
      course_id:   e.courseId,
      course_name: e.courseCode,
      title:       e.title,
      exam_date:   new Date(e.date).toISOString(),
    }))

  if (toInsert.length === 0) {
    return NextResponse.json({ synced: 0, message: 'all found exams already exist' })
  }

  const { error } = await sb.from('exams').insert(toInsert)
  if (error) {
    console.error('[sync-exams] insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[sync-exams] inserted ${toInsert.length} exams for user ${user.id}`)
  return NextResponse.json({ synced: toInsert.length, events: toInsert })
}
