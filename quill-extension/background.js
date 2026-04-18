// Quill Chrome Extension — background service worker

import { QUILL_URL, ONQ_HOST } from './config.js'

async function getQuillToken() {
  const cookie = await chrome.cookies.get({ url: QUILL_URL, name: 'sb-access-token' })
  return cookie?.value ?? null
}

async function refreshQuillSession() {
  try {
    const res = await fetch(`${QUILL_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

async function postCookies(token, sessionVal, secureSessionVal) {
  return fetch(`${QUILL_URL}/api/sync-cookies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      d2lSessionVal:       sessionVal,
      d2lSecureSessionVal: secureSessionVal,
    }),
  })
}

let syncing = false

async function syncCookies() {
  if (syncing) return
  syncing = true
  try {
    // 1. Make sure the user is logged in to Quill
    let token = await getQuillToken()
    if (!token) {
      // Access token may have just expired — try a silent refresh before giving up
      if (await refreshQuillSession()) token = await getQuillToken()
    }
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
    let res = await postCookies(token, sessionVal.value, secureSessionVal.value)

    // Expired token — refresh once and retry
    if (res.status === 401) {
      if (await refreshQuillSession()) {
        const fresh = await getQuillToken()
        if (fresh) res = await postCookies(fresh, sessionVal.value, secureSessionVal.value)
      }
    }

    if (res.ok) {
      await chrome.storage.local.set({ status: 'connected', lastSync: Date.now() })
    } else if (res.status === 401) {
      await chrome.storage.local.set({ status: 'not_logged_in', lastSync: null })
    } else {
      console.error('[Quill] sync-cookies error', res.status)
      await chrome.storage.local.set({ status: 'error', lastSync: null })
    }
  } catch (err) {
    console.error('[Quill] syncCookies failed:', err)
    await chrome.storage.local.set({ status: 'error', lastSync: null })
  } finally {
    syncing = false
  }
}

// ── Run on install and browser startup ───────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => syncCookies())
chrome.runtime.onStartup.addListener(() => syncCookies())

// ── Auto-sync when user navigates OnQ ────────────────────────────────────────
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || !tab.url.includes(ONQ_HOST)) return
  syncCookies()
})

// ── React instantly when D2L rotates session cookies ─────────────────────────
// D2L refreshes d2lSecureSessionVal mid-session; without this listener the
// stored token goes stale until the next 30-min alarm fires.
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed) return
  if (cookie.domain !== ONQ_HOST && !cookie.domain.endsWith(`.${ONQ_HOST}`)) return
  if (cookie.name !== 'd2lSessionVal' && cookie.name !== 'd2lSecureSessionVal') return
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
