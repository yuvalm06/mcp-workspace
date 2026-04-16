// Quill Chrome Extension — background service worker

const QUILL_URL = 'https://quill-app-new.vercel.app'
const ONQ_HOST  = 'onq.queensu.ca'

async function getQuillToken() {
  const cookie = await chrome.cookies.get({ url: QUILL_URL, name: 'sb-access-token' })
  return cookie?.value ?? null
}

async function syncCookies() {
  // 1. Make sure the user is logged in to Quill
  const token = await getQuillToken()
  if (!token) {
    await chrome.storage.local.set({ status: 'not_logged_in', lastSync: null })
    return
  }

  // 2. Grab OnQ session cookies
  const [sessionVal, secureSessionVal] = await Promise.all([
    chrome.cookies.get({ url: `https://${ONQ_HOST}`, name: 'd2lSessionVal' }),
    chrome.cookies.get({ url: `https://${ONQ_HOST}`, name: 'd2lSecureSessionVal' }),
  ])

  if (!sessionVal || !secureSessionVal) {
    await chrome.storage.local.set({ status: 'disconnected', lastSync: null })
    return
  }

  // 3. POST cookies to Quill authenticated via Bearer token
  try {
    const res = await fetch(`${QUILL_URL}/api/sync-cookies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        d2lSessionVal:       sessionVal.value,
        d2lSecureSessionVal: secureSessionVal.value,
      }),
    })

    if (res.ok) {
      await chrome.storage.local.set({ status: 'connected', lastSync: Date.now() })
    } else if (res.status === 401) {
      await chrome.storage.local.set({ status: 'not_logged_in', lastSync: null })
    } else {
      console.error('[Quill] sync-cookies error', res.status)
      await chrome.storage.local.set({ status: 'error', lastSync: null })
    }
  } catch (err) {
    console.error('[Quill] syncCookies fetch failed:', err)
    await chrome.storage.local.set({ status: 'error', lastSync: null })
  }
}

// ── Run on install and browser startup ───────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => syncCookies())
chrome.runtime.onStartup.addListener(() => syncCookies())

// ── Auto-sync when user navigates OnQ ────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || !tab.url.includes(ONQ_HOST)) return
  syncCookies()
})

// ── Manual sync from popup ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'sync') {
    syncCookies().then(() => sendResponse({ ok: true }))
    return true
  }
})

// ── Periodic refresh every 30 minutes ────────────────────────────────────────
chrome.alarms.create('sync', { periodInMinutes: 30 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') syncCookies()
})
