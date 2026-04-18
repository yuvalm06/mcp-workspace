import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { D2L_API, getD2LSession, d2lGet } from '@/lib/d2l'
import { filterActiveCourses } from '@/lib/coursePrefs'

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const d2l = await getD2LSession(user.id)
  if (!d2l) return NextResponse.json([])

  const daysAhead = Number(new URL(req.url).searchParams.get('daysAhead') || 60)
  const now       = new Date()
  const start     = now.toISOString()
  const end       = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString()

  // Fetch user's active courses (reuse the same logic as /api/courses)
  let courseList: { id: number; code: string }[] = []
  try {
    const allItems: any[] = []
    let bookmark: string | null = null
    const d2lHost = d2l.host

    while (true) {
      const url: string = bookmark
        ? `https://${d2lHost}/d2l/api/lp/1.43/enrollments/myenrollments/?bookmark=${encodeURIComponent(bookmark)}`
        : `https://${d2lHost}/d2l/api/lp/1.43/enrollments/myenrollments/`
      const res = await fetch(url, { headers: { Cookie: d2l.cookieHeader } })
      if (!res.ok) break
      const data = await res.json()
      allItems.push(...(data.Items || []))
      if (data.PagingInfo?.HasMoreItems && data.PagingInfo.Bookmark) {
        bookmark = data.PagingInfo.Bookmark
      } else {
        break
      }
    }

    const raw = allItems
      .filter((e: any) => e.OrgUnit.Type.Code === 'Course Offering')
      .map((e: any) => ({
        id:        e.OrgUnit.Id,
        name:      e.OrgUnit.Name,
        code:      e.OrgUnit.Code,
        canAccess: e.Access.CanAccess,
        isActive:  e.Access.IsActive,
        lastAccessed: e.Access.LastAccessed,
      }))

    courseList = filterActiveCourses(raw)
  } catch (err) {
    console.error('[deadlines] course fetch failed:', err)
    return NextResponse.json([])
  }

  if (courseList.length === 0) return NextResponse.json([])

  // Fetch calendar events for each course in parallel
  const params = new URLSearchParams({ startDateTime: start, endDateTime: end }).toString()
  const results = await Promise.allSettled(
    courseList.map(async (course) => {
      const data = await d2lGet(d2l, `/d2l/api/le/${D2L_API}/${course.id}/calendar/events/myEvents/?${params}`)
      const objects: any[] = data?.Objects || []
      return objects.map((e: any) => ({
        title:      e.Title,
        endDate:    e.EndDateTime,
        courseId:   course.id,
        courseCode: course.code,
      }))
    })
  )

  const allDeadlines: any[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') allDeadlines.push(...r.value)
  }

  allDeadlines.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())

  return NextResponse.json(allDeadlines)
}
