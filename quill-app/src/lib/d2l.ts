import { supabaseServer } from '@/lib/supabaseServer'

// ── Constants & types ─────────────────────────────────────────────────────────

export const D2L_API = '1.57'

export interface D2LSession { cookieHeader: string; host: string }

export interface PdfResult { cacheHit: boolean; chars: number; error?: string }

export type SourceType = 'LECTURE' | 'PAST EXAM' | 'TUTORIAL' | 'ASSIGNMENT' | 'FORMULA SHEET' | 'LAB' | 'OTHER'

export interface PdfCandidate {
  url: string
  title: string
  parentTitle: string
  sourceType: SourceType
  index: number
}

export const SOURCE_TYPE_PRIORITY: Record<SourceType, number> = {
  'PAST EXAM':     0,
  'FORMULA SHEET': 1,
  'LECTURE':       2,
  'TUTORIAL':      3,
  'ASSIGNMENT':    4,
  'LAB':           5,
  'OTHER':         6,
}

// ── D2L session ───────────────────────────────────────────────────────────────

export async function getD2LSession(userId: string): Promise<D2LSession | null> {
  const { data, error } = await supabaseServer()
    .from('user_credentials')
    .select('token, host')
    .eq('user_id', userId)
    .eq('service', 'd2l')
    .single()
  if (error || !data) return null
  try {
    const { d2lSessionVal, d2lSecureSessionVal } = JSON.parse(data.token as string)
    if (!d2lSessionVal || !d2lSecureSessionVal) return null
    return {
      cookieHeader: `d2lSessionVal=${d2lSessionVal}; d2lSecureSessionVal=${d2lSecureSessionVal}`,
      host: (data.host as string) || 'onq.queensu.ca',
    }
  } catch { return null }
}

export async function d2lGet(session: D2LSession, path: string): Promise<any> {
  const url = `https://${session.host}${path}`
  const res = await fetch(url, { headers: { Cookie: session.cookieHeader } })
  if (!res.ok) {
    console.error('[d2l]', path, res.status)
    return null
  }
  return res.json()
}

// ── PDF fetch + vision extract + cache ───────────────────────────────────────

export async function getPdfText(
  session: D2LSession,
  url: string,
  debugOut?: PdfResult
): Promise<string | null> {
  const sb = supabaseServer()

  // 1. Cache hit
  const { data } = await sb.from('pdf_cache').select('text').eq('url', url).single()
  if (data?.text) {
    if (debugOut) { debugOut.cacheHit = true; debugOut.chars = data.text.length }
    return data.text
  }

  // 2. Download with D2L session cookies
  const fullUrl = url.startsWith('http') ? url : `https://${session.host}${url}`
  let res: Response
  try {
    res = await fetch(fullUrl, { headers: { Cookie: session.cookieHeader }, redirect: 'follow' })
  } catch (err: any) {
    const msg = `fetch failed: ${err?.message}`
    console.error('[pdf]', msg)
    if (debugOut) debugOut.error = msg
    return null
  }
  if (!res.ok) {
    const msg = `HTTP ${res.status}`
    console.error('[pdf] download error', msg, fullUrl)
    if (debugOut) debugOut.error = msg
    return null
  }
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    const msg = 'got HTML — session expired?'
    console.error('[pdf]', msg)
    if (debugOut) debugOut.error = msg
    return null
  }

  // 3. Extract via Gemini Flash vision (via OpenRouter)
  let text: string | null = null
  try {
    const buf = Buffer.from(await res.arrayBuffer())
    const base64 = buf.toString('base64')

    const visionRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:application/pdf;base64,${base64}` },
            },
            {
              type: 'text',
              text: `Extract all content from this document page by page. For each page, include:
- All printed text and equations (preserve LaTeX where possible)
- All handwritten annotations, notes, and comments — label these as [HANDWRITTEN]
- Diagrams described in words
- Any text that is starred, circled, underlined, boxed, or written in caps — label these as [EMPHASIS]
- Any phrases like "important", "common mistake", "confusing", "note:", "remember" — label these as [PROFESSOR NOTE]
- Specific numerical examples with actual values — preserve the exact numbers

The goal is to capture not just what was written, but what the professor wanted to emphasize. Be thorough and preserve the page structure.`,
            },
          ],
        }],
      }),
    })

    const visionData = await visionRes.json()
    text = visionData.choices?.[0]?.message?.content?.trim() || null
    if (!visionRes.ok) throw new Error(visionData.error?.message || `HTTP ${visionRes.status}`)
  } catch (err: any) {
    const msg = `vision error: ${err?.message}`
    console.error('[pdf]', msg)
    if (debugOut) debugOut.error = msg
    return null
  }
  if (!text) {
    if (debugOut) debugOut.error = 'empty text after parse'
    return null
  }

  if (debugOut) { debugOut.cacheHit = false; debugOut.chars = text.length }

  // 4. Cache for next time (fire-and-forget)
  sb.from('pdf_cache').upsert({ url, text }).then(() => {})

  return text
}

// ── Source type detection ─────────────────────────────────────────────────────

export function detectSourceType(title: string, parentTitle: string): SourceType {
  const t = (title + ' ' + parentTitle).toLowerCase()
  if (/midterm|past[\s_-]?test|past[\s_-]?exam|previous[\s_-]?exam|sample[\s_-]?exam/.test(t)) return 'PAST EXAM'
  if (/formula|reference[\s_-]?sheet|cheat[\s_-]?sheet|equation[\s_-]?sheet/.test(t)) return 'FORMULA SHEET'
  if (/\btut(orial)?\b|\bica\b|in[\s-]?class[\s-]?activ/.test(t)) return 'TUTORIAL'
  if (/\bassignment\b|\bhomework\b/.test(t)) return 'ASSIGNMENT'
  if (/\blab\b/.test(t)) return 'LAB'
  if (/lecture|slides|notes|week/.test(t)) return 'LECTURE'
  return 'OTHER'
}

// ── PDF collection from D2L content tree ─────────────────────────────────────

export function findSyllabus(modules: any[]): string | null {
  for (const mod of modules) {
    for (const topic of mod.topics || []) {
      const url: string   = topic.url || ''
      const title: string = (topic.title || '').toLowerCase()
      if (url.endsWith('.pdf') && title.includes('syllabus')) return url
    }
    const found = findSyllabus(mod.modules || [])
    if (found) return found
  }
  return null
}

export function extractWeekNumber(s: string): number | null {
  const m = s.toLowerCase().match(/(?:week|wk)[_\s-]?(\d{1,2})/)
  return m ? parseInt(m[1], 10) : null
}

export function extractLectureNumber(s: string): number | null {
  const m = s.toLowerCase().match(/(?:lecture|lec|lect)[_\s-]?(\d{1,2})/)
  return m ? parseInt(m[1], 10) : null
}

export function collectCoursePdfs(modules: any[]): PdfCandidate[] {
  const raw: PdfCandidate[] = []
  let idx = 0
  function walk(mods: any[]) {
    for (const mod of mods) {
      for (const topic of mod.topics || []) {
        const url: string   = topic.url || ''
        const title: string = topic.title || ''
        const parentTitle: string = mod.title || ''
        if (!url.endsWith('.pdf')) continue
        const tl = title.toLowerCase()
        if (tl.includes('syllabus') || tl.includes('solution') || tl.includes('answer key')) continue
        raw.push({ url, title, parentTitle, sourceType: detectSourceType(title, parentTitle), index: idx++ })
      }
      walk(mod.modules || [])
    }
  }
  walk(modules)

  // Remove _blank versions when an annotated counterpart exists in the same folder
  const annotatedTitles = new Set(
    raw
      .filter(c => !c.title.toLowerCase().includes('_blank'))
      .map(c => c.title.toLowerCase().replace(/_blank/g, '').replace(/\s+blank$/i, ''))
  )
  return raw.filter(c => {
    if (!c.title.toLowerCase().includes('_blank')) return true
    const base = c.title.toLowerCase().replace(/_blank/g, '').replace(/\s+blank$/i, '')
    return !annotatedTitles.has(base)
  })
}

// ── Keyword extraction + relevance scoring ────────────────────────────────────
// Used to find practice materials topically related to a lecture's content.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'need', 'used', 'also', 'then', 'than',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'between', 'out', 'and', 'or', 'but', 'if', 'that', 'this',
  'these', 'those', 'it', 'its', 'we', 'you', 'he', 'she', 'they', 'not',
  'no', 'so', 'when', 'where', 'which', 'what', 'how', 'who', 'any', 'all',
  'each', 'some', 'such', 'both', 'more', 'most', 'other', 'same', 'only',
  'very', 'just', 'over', 'here', 'there', 'about', 'after', 'before',
  // Academic noise
  'page', 'slide', 'figure', 'fig', 'example', 'note', 'week', 'lecture',
  'module', 'professor', 'student', 'course', 'class', 'section', 'part',
  'handwritten', 'emphasis', 'given', 'find', 'show', 'let', 'using', 'use',
  'consider', 'assume', 'define', 'note', 'see', 'since', 'thus', 'hence',
])

export function extractKeywords(text: string, topN = 30): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w))

  const freq: Record<string, number> = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1

  // Bigrams are far more discriminating (e.g. "control volume", "reynolds transport")
  for (let i = 0; i < words.length - 1; i++) {
    if (!STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i + 1])) {
      const bg = `${words[i]} ${words[i + 1]}`
      freq[bg] = (freq[bg] || 0) + 1
    }
  }

  return Object.entries(freq)
    .filter(([_, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w)
}

export function scoreRelevance(text: string, keywords: string[]): number {
  const lower = text.toLowerCase()
  return keywords.reduce((score, kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const count = (lower.match(new RegExp(escaped, 'g')) || []).length
    // Bigrams weighted 3× — they're much more specific than single words
    return score + count * (kw.includes(' ') ? 3 : 1)
  }, 0)
}
