const dot        = document.getElementById('dot')
const statusText = document.getElementById('status-text')
const lastSyncEl = document.getElementById('last-sync')
const hintEl     = document.getElementById('hint')
const openQuill  = document.getElementById('open-quill')
const signinBtn  = document.getElementById('signin-btn')
const syncBtn    = document.getElementById('sync-btn')

const QUILL_URL = 'https://quill-app-new.vercel.app'

openQuill.href = QUILL_URL

const STATES = {
  connected: {
    dot: 'connected', label: 'Connected to OnQ', hint: '', action: 'sync',
  },
  disconnected: {
    dot: 'pending', label: 'OnQ not detected',
    hint: 'Visit onq.queensu.ca — Quill will sync automatically.',
    action: 'sync',
  },
  not_logged_in: {
    dot: 'error', label: 'Not signed in to Quill',
    hint: 'Sign in to your Quill account to connect OnQ.',
    action: 'signin',
  },
  error: {
    dot: 'error', label: 'Sync failed',
    hint: 'Check your connection and try again.',
    action: 'sync',
  },
}

function applyState(status, lastSync) {
  const state = STATES[status] || STATES['disconnected']
  dot.className          = 'dot ' + state.dot
  statusText.textContent = state.label
  hintEl.textContent     = state.hint

  if (lastSync) {
    const mins = Math.round((Date.now() - lastSync) / 60000)
    lastSyncEl.textContent = mins < 1 ? 'Synced just now' : `Synced ${mins}m ago`
  } else {
    lastSyncEl.textContent = ''
  }

  if (state.action === 'signin') {
    signinBtn.href = QUILL_URL + '/login'
    signinBtn.classList.remove('hidden')
    syncBtn.classList.add('hidden')
  } else {
    signinBtn.classList.add('hidden')
    syncBtn.classList.remove('hidden')
  }
}

async function render() {
  const { status, lastSync } = await chrome.storage.local.get(['status', 'lastSync'])
  if (status) {
    applyState(status, lastSync)
  } else {
    // Nothing stored yet — kick off a sync and poll for the result
    triggerSync()
  }
}

async function triggerSync() {
  syncBtn.textContent = 'Syncing…'
  syncBtn.disabled    = true
  syncBtn.classList.remove('hidden')
  signinBtn.classList.add('hidden')

  // Tell the background to sync (fire and forget — it may not respond instantly)
  try { chrome.runtime.sendMessage({ type: 'sync' }) } catch (_) {}

  // Poll storage until we get a result (up to 5 seconds)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500))
    const { status, lastSync } = await chrome.storage.local.get(['status', 'lastSync'])
    if (status) {
      applyState(status, lastSync)
      syncBtn.textContent = 'Sync now'
      syncBtn.disabled    = false
      return
    }
  }

  // Timed out — show error
  applyState('error', null)
  syncBtn.textContent = 'Sync now'
  syncBtn.disabled    = false
}

syncBtn.addEventListener('click', async () => {
  syncBtn.textContent = 'Syncing…'
  syncBtn.disabled    = true
  // Clear old status so we can detect the new one
  await chrome.storage.local.remove(['status', 'lastSync'])
  await triggerSync()
})

render()
