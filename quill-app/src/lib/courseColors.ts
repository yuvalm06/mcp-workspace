const COURSE_COLORS = [
  { accent: '#3A5F9E', tint: '#E8EEF7', tab: '#DAE0E9' },
  { accent: '#4A8C5E', tint: '#EEF2E8', tab: '#E0E4DA' },
  { accent: '#C97C2A', tint: '#F5EDDF', tab: '#E6DFD2' },
  { accent: '#8B6AAF', tint: '#EDE8F2', tab: '#DFDAE4' },
  { accent: '#5B8FA8', tint: '#E5EFF4', tab: '#D7E5EC' },
  { accent: '#A85B6A', tint: '#F4E5E8', tab: '#E8D9DB' },
]

export function getCourseColor(index: number) {
  return COURSE_COLORS[index % COURSE_COLORS.length]
}

export function getHour() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
