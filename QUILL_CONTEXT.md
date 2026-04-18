# Quill — Project Context
*"Your semester, understood."*

---

## What Quill Is

Quill is an AI academic accountability platform for university students. It connects to Queen's University's D2L learning management system (OnQ) and automatically knows the student's courses, lecture content, deadlines, and grades — without the student having to upload anything manually.

**Tagline:** "Your semester, understood."
**Three-word pitch:** It already knows.

Quill is not a D2L replacement. It's the intelligent layer on top. Every other study tool requires manual PDF upload every time. Quill connects once via a browser extension and stays in sync automatically. The student installs the extension, visits OnQ, and Quill silently reads their session cookies and pulls everything.

**The core loop:**
Quill knows your courses → pre-builds study content without being asked → surfaces it proactively → student acts with one tap → Quill learns habits and adapts.

---

## Tech Stack

- **MCP server:** `~/mcp-workspace/quill/` (Node.js/TypeScript), port 3000, start with `node dist/index.js`
- **Next.js app:** `~/mcp-workspace/quill-app/` (Next.js 15), port 3001, start with `npm run dev`
- **Database:** Supabase (PostgreSQL)
- **D2L host:** onq.queensu.ca
- **AI:** OpenAI GPT-4o for general features, Anthropic Claude API for course chat
- **Dev auth bypass:** `SKIP_JWT_AUTH=1`, `MCP_USER_ID=dev`, `x-user-id: dev` header

---

## Design System — NEVER DEVIATE FROM THIS

### Colors
```css
--bg: #F7F4EF
--ink: #1A1714
--ink-muted: #9A9284
--ink-ghost: #C4BDB0
--accent: #3A5F9E
--border: rgba(154, 146, 132, 0.25)
```

### Course Colors
| Accent | Tint |
|---|---|
| `#3A5F9E` | `#E8EEF7` |
| `#4A8C5E` | `#EEF2E8` |
| `#C97C2A` | `#F5EDDF` |
| `#8B6AAF` | `#EDE8F2` |

### Typography
- **Cormorant Garamond weight 300** — all headings, greeting, wordmark
- **DM Sans** — body text, labels, buttons
- **DM Mono** — course codes, timestamps, data labels

### Surfaces
- Card hairline: `inset 0 0 0 0.5px rgba(0,0,0,0.055)`
- Warm shadows: `rgba(24,22,15,...)` — never pure black
- Paper grain overlay: fixed, `z-index: 9999`, `opacity: 0.052`
- Logo: feather SVG at `public/logo.svg`, wordmark lowercase "quill"

---

## Supabase Tables

- `user_credentials` — D2L session cookies per user: `{"d2lSessionVal":"...","d2lSecureSessionVal":"..."}`
- `exams` — user-added exam dates (id, user_id, course_id, course_name, title, exam_date, location)
- `routines` — user routines (id, user_id, name, emoji, color, trigger_type, trigger_config JSON, actions JSON array, is_active)
- `routine_outputs` — output from routine runs (id, routine_id, user_id, output_type, output_content, created_at, reviewed_at)
- `calendar_events` — general calendar events (id, user_id, title, course_id, start_time, end_time, color)

---

## W26 Course IDs

```
1109841 — MECH 210 W26
1110300 — APSC 200 W26
1111819 — MECH 203 W26
1112937 — MECH 241 W26
1123309 — MECH 228 W26
1124097 — MECH 273 W26
```

---

## How MCP Calls Work

MCP calls MUST go through Next.js API routes — never call MCP from the browser (CORS). Pattern:

```typescript
// 1. Initialize session
const initRes = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'quill-app', version: '1.0' } }, id: 1 }),
})
const sessionId = initRes.headers.get('mcp-session-id')

// 2. Call tool
const res = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'mcp-session-id': sessionId,
    'x-user-id': USER_ID,
  },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'tool_name', arguments: {} }, id: 2 }),
})

// 3. Parse SSE response
const text = await res.text()
const line = text.split('\n').find(l => l.startsWith('data:'))
const json = JSON.parse(line.slice(5))
const result = JSON.parse(json.result?.content?.[0]?.text)
```

---

## Full Feature Spec

### Phase 1 — Core Product

**1. OnQ Connection via Browser Extension**
- Student installs Chrome extension, visits onq.queensu.ca (already logged in)
- Extension silently reads `d2lSessionVal` and `d2lSecureSessionVal` cookies
- Sends them to `POST /api/sync-cookies` with the Quill user ID
- Stored in `user_credentials` table — MCP server reads from there
- Quill never sees the student's university password

**2. Automatic Course Sync**
- On every OnQ visit, extension checks for new content
- Pulls courses, grades, announcements, deadlines, lecture PDFs
- Stores in Supabase — app works even when extension isn't open

**3. Auth System**
- Sign up / login via Supabase Auth (email + password + Google OAuth)
- Session JWT stored as cookie on the domain
- Middleware protects all `/(app)/*` routes — redirect to `/login` if not authenticated
- Every API route reads real user ID from session — never hardcoded 'dev'
- `/onboarding` — 3-step wizard: install extension → connect OnQ → add exams

**4. Dashboard**
- Greeting with date and week number
- Sub-line with most urgent context: "Week 15 · MECH 241 exam in 3 days"
- Horizontal scrollable course folder cards — click to open course chat
- "From Quill" vertical feed — prepared items, nudges, in-progress sessions
- Exam prompt on first load: "I don't see your exams on OnQ — want to add them?"
- Manage button to hide/show courses

**5. Course Folder Cards**
- Colored background (course color system)
- Course code in DM Mono, course name in Cormorant Garamond
- Ghost text: "Chat with [code] →"
- Exam countdown if exam within 7 days
- Clicking opens scoped course chat

**6. From Quill Feed**
- Cards with STUDY / PRACTICE / RECALL / NUDGE tags in course color
- Pre-built by Quill without being asked
- ≤3 days to exam → "Practice exam ready" (red)
- ≤7 days to exam → "Review set ready" (amber)
- Content not studied recently → "Recall set" (green)
- Course not opened in 5+ days → "NUDGE"
- Empty state: "You're prepared." in Cormorant Garamond italic — Quill's inbox-zero moment

**7. Exam Date Management**
- Exams not in D2L calendar — user adds manually
- Modal: course selector, exam type, date, time, optional location
- Stored in Supabase, drives briefing logic and calendar blocks

**8. Course Chat**
- Every course has its own scoped AI chat
- Grounded in that course's actual lecture slides, tutorials, past exams, formula sheets
- Downloads PDFs via MCP, sends to Claude API with course context
- Three response modes detected from intent:
  - **Brief mode** ("what was covered", "summarize") — structured overview with rich bullets
  - **Teach mode** ("teach me", "explain", "walk me through") — actual tutoring, step by step, worked examples, formulas, not just definitions
  - **Practice mode** ("quiz me", "test me") — generates problem, waits for answer, grades it
- Response renderer supports: prose summary, rich bullets with bold labels, KaTeX formulas, inline code, highlight boxes (✦), quick check questions, source pills linking to PDF pages
- Chat history per course, searchable across all courses in sidebar
- Weekly confidence panel — slides out from header button, shows per-week dot indicators (●●●● to ○○○○)
- Sources shown as pills at bottom of each response linking to actual PDF pages

**9. Practice Exam Generator**
- Downloads lecture PDFs via MCP
- Generates: 3 multiple choice, 2 short answer, 1 problem
- Grounded in professor's actual content
- Uses past exams/tutorials from course content when available

**10. Active Recall / Flashcards**
- Short sessions 5–10 minutes
- Generated from recent lecture slides automatically
- Quill pre-builds without being asked
- Progress tracked, resumed if incomplete
- Spaced repetition — wrong cards come back

**11. Routines System**
- User-created automations: trigger → chain of actions
- Accessible via + button in sidebar
- Triggers: event (new lecture, exam in N days, new announcement), schedule (daily/weekly/custom), manual
- Actions: summarize, recall set, practice exam, briefing, quiz weakest topics, break down assignment, add study block, calculate grade impact, notify
- Pre-built templates: Stay caught up, Exam prep, Weekly review, Grade tracker
- Detail view shows output feed — every time routine fires, output saved here
- Red badge on sidebar icon = unreviewed output

**12. Calendar**
- Weekly view Mon–Sun
- Class blocks from OnQ timetable (colored by course)
- Exam blocks from Supabase
- Study blocks from Routines
- Google Calendar-style interaction: click block = popover, click empty = create event
- + button fixed bottom right

**13. Notifications**
- Bell icon with badge in sidebar
- "From Quill" interactive question cards
- Types: date picker, choice pills, text input
- Examples: "When is your MECH 241 final?", "Did you attend Tuesday's lecture?"

### Phase 2 — Intelligence + Expansion

- Passive lecture detection — extension tracks which OnQ pages student actually opens
- Time-on-page tracking — 4 min on 40 slides = skim, not study
- Real-time grade alerts — extension detects new grades on OnQ visit
- Announcement parsing — captures professor announcements, flags important ones
- Missed lecture catch-up — structured brief: key concepts, examples, what to know before next class
- Study plan builder — day-by-day plan across all upcoming exams
- Grade impact calculator — "if I get 80% on final, what's my grade?"
- Background content pre-building — nightly cron, builds practice sets before student asks
- GoodNotes integration — connect Google Drive, index GoodNotes backup PDFs per course

### Phase 3 — Habit Learning + Social

- Habit learning engine — adapts nudge timing and session length per user over time
- Smart proactive nudges — browser push then mobile push
- Cross-device continuity — start on laptop, resume on phone
- Study streak tracking — ambient, not aggressively gamified
- Shared practice sets — shareable link, others in same course can attempt

---

## Onboarding Flow

### Phase 1
1. Install extension — one click Chrome/Safari
2. Visit OnQ — extension auto-connects, pulls all courses
3. Add exam dates — exams not in D2L calendar

### Phase 2 (adds optional step)
1. Install extension
2. Visit OnQ
3. Connect Google Drive (optional) — for GoodNotes notes
4. Add exam dates

---

## Trust & Privacy

- Quill never sees the student's university password
- Extension only activates on onq.queensu.ca
- Cookies expire naturally — access is time-limited
- Quill reads: course content, grades, deadlines, announcements
- Quill never touches: submissions, financial records, personal university data

---

## Distribution

- **Domain/handle:** tryquill.app
- **Launch:** Queen's University Engineering students, word of mouth
- **Growth:** other Queen's faculties → other Canadian universities → US universities

---

## Next Priorities (In Order)

1. **Auth system** — Supabase Auth, signup/login pages, Google OAuth, session middleware, replace all hardcoded 'dev' user IDs with real session-based IDs
2. **Chrome extension** — Manifest V3, reads Quill session cookie on tryquill.app, reads D2L cookies on onq.queensu.ca, sends to backend
3. **`POST /api/sync-cookies`** — receives cookies from extension, writes to user_credentials table
4. **Real From Quill feed** — logic based on exam dates and content, not hardcoded placeholders
5. **Deploy to Vercel** — all env vars, extension points to production URL

---

## What Must Not Be Touched

- Design tokens in globals.css — colors, fonts, spacing are locked
- Sidebar blob animation — working, leave it
- Routines modal — complete, leave it
- Paper grain overlay — must stay
- Warm shadow convention — never use pure black shadows
