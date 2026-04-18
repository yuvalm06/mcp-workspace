import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  D2L_API,
  getD2LSession,
  d2lGet,
  getPdfText,
  collectCoursePdfs,
} from '@/lib/d2l'

export const maxDuration = 300 // Vercel Pro: up to 5 min per invocation

/**
 * POST /api/preparse
 * Body: { courseId: string | number, batchSize?: number, offset?: number }
 *
 * Downloads and caches parsed text for every PDF in a D2L course.
 * Call repeatedly with increasing offset until remaining === 0.
 *
 * Returns:
 *   { total, alreadyCached, processed, failed, remaining, nextOffset }
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { courseId, batchSize = 8, offset = 0 } = await req.json()
  if (!courseId) return NextResponse.json({ error: 'courseId required' }, { status: 400 })

  const d2l = await getD2LSession(user.id)
  if (!d2l) return NextResponse.json({ error: 'No D2L session — reconnect your account' }, { status: 401 })

  // 1. Fetch TOC
  const tocRaw = await d2lGet(d2l, `/d2l/api/le/${D2L_API}/${Number(courseId)}/content/toc`)
  if (!tocRaw?.Modules) return NextResponse.json({ error: 'Could not load course TOC' }, { status: 502 })

  function marshalMod(m: any): any {
    return {
      title: m.Title,
      topics: (m.Topics || []).map((t: any) => ({ title: t.Title, url: t.Url || '' })),
      modules: (m.Modules || []).map(marshalMod),
    }
  }
  const modules = tocRaw.Modules.map(marshalMod)
  const allPdfs = collectCoursePdfs(modules)

  // 2. Check which are already cached
  const allUrls = allPdfs.map(p => p.url)
  const { data: cached } = await supabaseServer()
    .from('pdf_cache')
    .select('url')
    .in('url', allUrls)
  const cachedUrls = new Set((cached || []).map((r: any) => r.url))

  const uncached = allPdfs.filter(p => !cachedUrls.has(p.url))
  const batch    = uncached.slice(offset, offset + batchSize)

  // 3. Parse and cache each file in the batch
  let processed = 0
  let failed    = 0
  for (const pdf of batch) {
    try {
      const text = await getPdfText(d2l, pdf.url)
      if (text) {
        processed++
        console.log(`[preparse] cached: ${pdf.title} (${text.length} chars)`)
      } else {
        failed++
        console.warn(`[preparse] no text: ${pdf.title}`)
      }
    } catch (err: any) {
      failed++
      console.error(`[preparse] error: ${pdf.title}`, err?.message)
    }
  }

  const remaining  = Math.max(0, uncached.length - offset - batchSize)
  const nextOffset = remaining > 0 ? offset + batchSize : null

  return NextResponse.json({
    total:         allPdfs.length,
    alreadyCached: cachedUrls.size,
    uncached:      uncached.length,
    processed,
    failed,
    remaining,
    nextOffset,
    batchProcessed: batch.length,
  })
}
