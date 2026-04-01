# Horizon

An MCP server that connects AI assistants to your university's D2L Brightspace and Piazza. Sign up once, then use Claude, Poke, or any MCP client to check grades, assignments, deadlines, course content, and Piazza posts — all from your AI assistant.

## What it does

Horizon exposes your D2L and Piazza data as MCP tools:

- **get_my_courses** — list all enrolled courses
- **get_my_grades** — check grades for any course
- **get_assignments** / **get_assignment_submissions** — assignments, due dates, submission status
- **get_upcoming_due_dates** — deadlines within a time window
- **get_course_content** — syllabus, modules, lecture materials
- **get_announcements** — instructor posts and updates
- **download_file** / **read_file** — download and read course PDFs
- **piazza_search** / **piazza_get_posts** — search and browse Piazza
- **notes_search** / **semantic_search_notes** — semantic search over uploaded course notes
- **tasks_list** / **plan_week** — task tracking and weekly study plans
- **sync_all** — sync all assignments as tasks from every enrolled course

## Architecture

```
MCP Client (Claude, Poke, etc.)
    |
    | HTTPS + Streamable HTTP
    v
Go Gateway (auth, rate limiting, metrics)
    |
    | HTTP proxy
    v
Node.js MCP Server (tools, D2L API, Piazza API)
    |
    +---> Supabase (users, tasks, notes, embeddings)
    +---> D2L Brightspace API (session cookies)
    +---> Piazza API (SSO cookies)
    +---> S3 (browser state persistence)
    +---> OpenAI (embeddings for semantic search)
```

## Structure

```
d2l-mcp/
  gateway/         Go reverse proxy — JWT/API key auth, rate limiting, Prometheus
  src/             Node.js MCP server
    api/           REST routes (onboarding, file upload, push notifications)
    browser/       Playwright browser sessions for D2L login via VNC
    jobs/          Background session refresh scheduler
    study/         Study tools (notes, tasks, Piazza sync, semantic search)
    public/        Onboarding page
  scripts/         Deployment scripts
study-mcp-app/     React Native companion app (Expo)
supabase/          Database migrations
```

## Self-hosting

### Prerequisites

- Node.js 20+, Go 1.22+, Docker
- Supabase project (free tier works)
- AWS account (ECS Fargate, S3, Secrets Manager)
- OpenAI API key (for semantic search embeddings)
- A D2L Brightspace instance you have access to

### 1. Clone and configure

```bash
git clone https://github.com/hamzaammar/horizon.git
cd horizon/d2l-mcp
cp .env.template .env
# Fill in your credentials
```

### 2. Run the database migrations

Run each SQL file in `src/study/db/migrations/` in your Supabase SQL editor, in order.

### 3. Local development

```bash
npm install
npm run build
npm start
# Server runs at http://localhost:3000/mcp
```

### 4. Deploy to AWS

```bash
# Copy task-definition.example.json to task-definition.json
# Replace all <PLACEHOLDER> values with your AWS account details
bash scripts/deploy-to-ecs.sh
```

See `task-definition.example.json` for the full ECS Fargate configuration.

### 5. Connect your MCP client

Point any MCP client at your server:

| Setting | Value |
|---------|-------|
| URL | `https://your-domain.com/mcp` |
| Auth | `Authorization: Bearer <your-api-key>` |

Generate an API key from the onboard page or via `POST /api/api-keys`.

## Authentication

Horizon supports three auth methods:

- **API keys** (`hzn_...`) — never expire, best for MCP clients like Poke
- **Supabase JWTs** — standard access tokens, expire in 1 hour
- **Refresh tokens** — auto-exchanged for fresh JWTs by the gateway

D2L sessions are refreshed automatically in the background using saved browser state from S3. If the ADFS session expires (typically after 30-90 days), the user gets a push notification to re-authenticate via the onboard page.

## License

MIT
