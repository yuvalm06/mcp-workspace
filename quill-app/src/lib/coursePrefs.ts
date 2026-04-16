const HIDDEN_KEY = 'quill-hidden-courses'

export function getHiddenCourseIds(): number[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveHiddenCourseIds(ids: number[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids))
}

export function filterActiveCourses<T extends { id: number }>(courses: T[]): T[] {
  const hidden = new Set(getHiddenCourseIds())
  return courses.filter(c => !hidden.has(c.id))
}
