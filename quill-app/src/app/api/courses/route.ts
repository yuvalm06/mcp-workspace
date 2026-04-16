import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

interface RawEnrollment {
  OrgUnit: { Id: number; Type: { Code: string; Name: string }; Name: string; Code: string; HomeUrl: string }
  Access: { IsActive: boolean; CanAccess: boolean; LastAccessed: string | null }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  // Load stored D2L session cookies for this user
  const { data: creds, error } = await supabaseServer()
    .from('user_credentials')
    .select('token, host')
    .eq('user_id', user.id)
    .eq('service', 'd2l')
    .single()

  if (error || !creds) {
    return NextResponse.json([])
  }

  let d2lSessionVal: string
  let d2lSecureSessionVal: string
  const d2lHost = (creds.host as string) || 'onq.queensu.ca'

  try {
    const parsed = JSON.parse(creds.token as string)
    d2lSessionVal       = parsed.d2lSessionVal
    d2lSecureSessionVal = parsed.d2lSecureSessionVal
    if (!d2lSessionVal || !d2lSecureSessionVal) throw new Error('missing')
  } catch {
    return NextResponse.json([])
  }

  const cookieHeader = `d2lSessionVal=${d2lSessionVal}; d2lSecureSessionVal=${d2lSecureSessionVal}`

  // Paginate through all enrollments
  const allItems: RawEnrollment[] = []
  let bookmark: string | null = null

  try {
    while (true) {
      const url = bookmark
        ? `https://${d2lHost}/d2l/api/lp/1.43/enrollments/myenrollments/?bookmark=${encodeURIComponent(bookmark)}`
        : `https://${d2lHost}/d2l/api/lp/1.43/enrollments/myenrollments/`

      const res = await fetch(url, {
        headers: { Cookie: cookieHeader },
      })

      if (!res.ok) {
        console.error('[courses] D2L API error', res.status, await res.text())
        break
      }

      const data = await res.json() as { Items: RawEnrollment[]; PagingInfo?: { Bookmark: string; HasMoreItems: boolean } }
      allItems.push(...(data.Items || []))

      if (data.PagingInfo?.HasMoreItems && data.PagingInfo.Bookmark) {
        bookmark = data.PagingInfo.Bookmark
      } else {
        break
      }
    }
  } catch (err) {
    console.error('[courses] fetch failed:', err)
    return NextResponse.json([])
  }

  // Marshal: only Course Offering type
  const courses = allItems
    .filter(e => e.OrgUnit.Type.Code === 'Course Offering')
    .map(e => ({
      id:           e.OrgUnit.Id,
      name:         e.OrgUnit.Name,
      code:         e.OrgUnit.Code,
      homeUrl:      e.OrgUnit.HomeUrl,
      isActive:     e.Access.IsActive,
      canAccess:    e.Access.CanAccess,
      lastAccessed: e.Access.LastAccessed,
    }))

  // Filter to current semester only (W26), exclude old semesters
  const current = courses.filter(c => {
    const code = (c.code || '').toUpperCase()
    const name = (c.name || '').toUpperCase()
    if (code.includes('W26') || name.includes('W26')) return true
    if (
      code.includes('F25') || code.includes('F24') ||
      code.includes('W25') || code.includes('S25') ||
      name.includes('F25') || name.includes('F24') ||
      name.includes('W25') || name.includes('S25')
    ) return false
    if (!c.canAccess) return false
    return true
  })

  return NextResponse.json(current)
}
