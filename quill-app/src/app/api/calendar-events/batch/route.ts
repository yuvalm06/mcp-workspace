import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import type { ParsedCourse } from '@/app/api/schedule-import/route'

function dateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

// Generate all occurrences of a course from startDate through endDate
function generateOccurrences(course: ParsedCourse, startDate: Date, endDate: Date) {
  const rows: { date: string; start_time: string; end_time: string; title: string; code: string }[] = []
  const cur = new Date(startDate)
  cur.setHours(0, 0, 0, 0)

  // For biweekly, track which weeks to include (odd/even from startDate)
  const semesterStart = new Date(startDate)
  semesterStart.setHours(0, 0, 0, 0)

  while (cur <= endDate) {
    const dow = cur.getDay() // 0=Sun … 6=Sat → convert to Mon=0
    const monFirst = (dow + 6) % 7  // Mon=0 … Sun=6

    if (course.days.includes(monFirst)) {
      if (course.biweekly) {
        // Only include if week number from semester start is even
        const weekNum = Math.floor((cur.getTime() - semesterStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
        if (weekNum % 2 !== 0) {
          cur.setDate(cur.getDate() + 1)
          continue
        }
      }
      rows.push({
        date:       dateStr(cur),
        start_time: course.startTime,
        end_time:   course.endTime,
        title:      course.title || course.courseCode,
        code:       course.courseCode,
      })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return rows
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { courses, semesterEnd, colorMap } = await req.json() as {
    courses: (ParsedCourse & { colorIdx: number })[]
    semesterEnd: string   // "YYYY-MM-DD"
    colorMap: Record<string, number>  // courseCode → colorIdx
  }

  if (!Array.isArray(courses) || !courses.length) {
    return NextResponse.json({ error: 'No courses provided' }, { status: 400 })
  }

  const startDate = new Date()
  startDate.setHours(0, 0, 0, 0)
  const endDate = new Date(semesterEnd + 'T00:00:00')

  if (endDate <= startDate) {
    return NextResponse.json({ error: 'semesterEnd must be in the future' }, { status: 400 })
  }

  const sb = supabaseServer()
  const allRows: any[] = []

  for (const course of courses) {
    const occurrences = generateOccurrences(course, startDate, endDate)
    const colorIdx = colorMap?.[course.courseCode] ?? course.colorIdx ?? 0
    for (const occ of occurrences) {
      allRows.push({ ...occ, user_id: user.id, color_idx: colorIdx })
    }
  }

  if (!allRows.length) {
    return NextResponse.json({ inserted: 0 })
  }

  const { error, count } = await sb.from('calendar_events').insert(allRows, { count: 'exact' })
  if (error) {
    console.error('[calendar-events/batch] Supabase error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ inserted: count ?? allRows.length })
}
