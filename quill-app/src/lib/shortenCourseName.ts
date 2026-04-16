// Shortens course names via GPT-4o, with localStorage caching so the API
// is called at most once per unique course name across all page loads.

const CACHE_KEY = 'quill-course-shorts-v1'

function readCache(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
  } catch {
    localStorage.removeItem(CACHE_KEY)
    return {}
  }
}

function writeCache(updates: Record<string, string>) {
  if (typeof window === 'undefined') return
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), ...updates }))
}

/**
 * Given an array of full course names, returns a map of { fullName → shortName }.
 * Already-cached names are resolved instantly from localStorage.
 * Uncached names are sent in a single batch request to /api/shorten-course-name.
 * Falls back to the original name on any error so the UI never breaks.
 */
export async function getShortenedNames(names: string[]): Promise<Record<string, string>> {
  if (names.length === 0) return {}

  const cache     = readCache()
  const uncached  = names.filter(n => !(n in cache))

  // All cached — resolve immediately without hitting the network
  if (uncached.length === 0) {
    return Object.fromEntries(names.map(n => [n, cache[n]]))
  }

  try {
    const res = await fetch('/api/shorten-course-name', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ names: uncached }),
    })
    if (!res.ok) throw new Error(`shorten-course-name ${res.status}`)

    const { shorts } = await res.json() as { shorts: Record<string, string> }

    if (shorts && typeof shorts === 'object') {
      writeCache(shorts)
      const merged = { ...cache, ...shorts }
      return Object.fromEntries(names.map(n => [n, merged[n] ?? n]))
    }
  } catch {
    // Network error or bad response — fall through to originals
  }

  return Object.fromEntries(names.map(n => [n, cache[n] ?? n]))
}
