# OpenFeedbackLayer

Open-source feedback widget with AI classification. A drop-in React component that captures user feedback, automatically classifies it using Gemini AI, and stores it in Supabase.

## Features

- **Floating feedback button** - Non-intrusive, appears in corner of screen
- **Screenshot support** - Paste, drag & drop, or click to attach images
- **AI classification** - Automatically categorizes feedback (bug/feature/question/billing/praise)
- **Feature area detection** - AI identifies which part of your product is mentioned
- **Priority scoring** - P0/P1/P2 based on urgency
- **Bot protection** - Honeypot field + rate limiting
- **Email notifications** - Get notified via Resend on new feedback
- **Supabase storage** - Screenshots stored in Supabase Storage

## Quick Start

### 1. Install the package

```bash
npm install openfeedbacklayer @supabase/supabase-js
# or
pnpm add openfeedbacklayer @supabase/supabase-js
# or
yarn add openfeedbacklayer @supabase/supabase-js
```

### 2. Add the widget to your app

```tsx
// app/layout.tsx or any layout component
import { FeedbackWidget } from 'openfeedbacklayer'

export default function Layout({ children }) {
  return (
    <html>
      <body>
        {children}
        <FeedbackWidget />
      </body>
    </html>
  )
}
```

### 3. Set up the API routes

Create the feedback route:

```ts
// app/api/feedback/route.ts
export { feedbackPOST as POST } from 'openfeedbacklayer/server'
```

Create the GitHub webhook route if you use subscriber journey emails:

```ts
// app/api/feedback/webhook/route.ts
export { webhookPOST as POST } from 'openfeedbacklayer/server'
```

### 4. Set up Supabase

Run the migrations in order in your Supabase SQL Editor:

```bash
ls node_modules/openfeedbacklayer/supabase/migrations
```

- `001_create_feedback.sql` and `002_feedback_journey.sql` are required. They
  apply on any Postgres (no Supabase-specific objects).
- `004_claim_stage_rpc.sql` is required if you use the subscriber journey
  (GitHub webhook stage emails). Without it the webhook cannot claim a stage
  and subscriber update emails are silently not sent.
- `003_screenshot_storage.sql` is optional: run it only if you use screenshot
  attachments. It requires Supabase Storage.

Apply them in numeric order (`001`, `002`, `004`; `003` whenever you enable
screenshots).

Or see [Migration SQL](./supabase/migrations).

### 5. Add environment variables

```env
# .env.local

# Required
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx

# For AI classification
GEMINI_API_KEY=AIzaSyxxx

# Optional: Email notifications
RESEND_API_KEY=re_xxx
FEEDBACK_NOTIFY_EMAIL=you@example.com
RESEND_FROM_EMAIL=feedback@yourdomain.com

# Optional: GitHub feedback journey
GITHUB_TOKEN=github_pat_xxx
GITHUB_FEEDBACK_REPO=owner/name
GITHUB_WEBHOOK_SECRET=change-me
```

For GitHub issue creation and subscriber email updates, install `@octokit/rest` and `resend` in the host app when those features are enabled.

## Configuration

### Widget Props

```tsx
<FeedbackWidget
  apiEndpoint="/api/feedback"       // API endpoint (default: /api/feedback)
  projectId="my-app"                // For multi-project setups
  position="bottom-right"           // bottom-right | bottom-left | top-right | top-left
  primaryColor="#2563eb"            // Button color
  buttonText="Feedback"             // Tooltip text
  placeholder="Describe your issue..." // Input placeholder
  collectEmail={true}               // Collect optional subscriber email
  emailPlaceholder="Your email..."  // Email input placeholder
  onSubmit={(data) => {}}           // Callback after submit
  onError={(error) => {}}           // Error callback
/>
```

## Feedback journey (GitHub + subscriber updates)

Set `GITHUB_TOKEN` and `GITHUB_FEEDBACK_REPO` to auto-open a GitHub issue for each feedback item. Install `@octokit/rest` and `resend` in the host app when GitHub issue creation and subscriber emails are enabled.

To email subscribers as feedback moves through the journey, configure a GitHub webhook:

- URL: `/api/feedback/webhook`
- Content type: `application/json`
- Events: Issues
- Secret: `GITHUB_WEBHOOK_SECRET`

Subscribers receive concise updates for received, triaged, in progress, shipped, and won't fix stages. Submitter email is stored only in Supabase and is never added to the public GitHub issue. GitHub issue redaction is best-effort defense-in-depth, not a guarantee, because the issue body can still include user-typed content.

### AI Classification Output

The AI returns structured data:

```json
{
  "title": "Export button not working",
  "short_summary": "User reports the export button has no effect when clicked.",
  "key_details": ["export button", "no response", "dashboard page"],
  "suggested_category": "bug",
  "suggested_feature_area": "export",
  "suggested_priority": "high",
  "steps": ["Go to dashboard", "Click export button"],
  "expected": "CSV file should download",
  "confidence": 0.95,
  "clarifying_questions": []
}
```

### Categories

- `bug` - Something is broken
- `feature` - Request for new functionality
- `question` - How-to or support query
- `billing` - Payment/subscription issues
- `praise` - Positive feedback
- `other` - Doesn't fit above

### Priority

- `high` → P0 - Blocking/urgent
- `medium` → P1 - Important
- `low` → P2 - Nice to have

### Feature Area

Free-form string detected by AI, e.g.:
- "export", "upload", "dashboard", "billing", "login", "UI", "performance"

## Database Schema

```sql
CREATE TABLE feedback (
  id UUID PRIMARY KEY,
  page_url TEXT NOT NULL,
  user_agent TEXT,
  project_id TEXT,
  message_raw TEXT NOT NULL,
  screenshot_url TEXT,
  ai_data JSONB,
  status TEXT DEFAULT 'new',
  submitter_email TEXT,
  subscribe BOOLEAN DEFAULT false,
  github_issue_number INTEGER,
  github_issue_url TEXT,
  github_repo TEXT,
  journey_stage TEXT DEFAULT 'received',
  last_emailed_stage TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Querying Feedback

```sql
-- Get all bugs by priority
SELECT * FROM feedback
WHERE ai_data->>'suggested_category' = 'bug'
ORDER BY
  CASE ai_data->>'suggested_priority'
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    ELSE 3
  END;

-- Get feedback by feature area
SELECT * FROM feedback
WHERE ai_data->>'suggested_feature_area' = 'export';

-- Count by category
SELECT
  ai_data->>'suggested_category' as category,
  COUNT(*) as count
FROM feedback
GROUP BY ai_data->>'suggested_category';
```

## Security

- **Honeypot field** - Hidden input that bots fill, humans don't (best-effort)
- **Rate limiting** - 10 requests/IP/minute, in-memory per process. Two
  hard limitations: (a) the header key (`x-forwarded-for` / `x-real-ip`)
  is client-spoofable, so deploy behind a trusted proxy/CDN (Vercel,
  Cloudflare, nginx) that overwrites it; (b) on serverless platforms
  (Vercel Functions, Cloudflare Workers, Lambda) every cold start gets a
  fresh process, so the cap is effectively a no-op for sustained abuse.
  **Production deployments must front this route with a distributed
  limiter** (Upstash Redis, Cloudflare KV, Supabase row-counter, or
  platform-native rate-limit middleware). The in-memory variant is
  best-effort for single-instance or long-lived containers only.
- **Screenshot upload** - server-side magic-byte sniff (PNG / JPEG / GIF /
  WebP) before upload, hard 5MB size cap. A `.png` that is actually
  HTML/JS is rejected with 415, defeating stored-XSS via the public bucket.
- **Supabase RLS** - Enable Row Level Security for access control
- **Server-only RPC** - `claim_feedback_stage` is REVOKEd from
  PUBLIC/anon/authenticated; only `service_role` may call it
- **Untrusted-text defanging** - feedback text is redacted (PII) and defanged
  (markdown / @mention / control-char) before it enters a GitHub issue
- **No credentials exposed** - All API keys are server-side only

## Cost

Using Gemini 2.5 Flash Lite:
- ~$0.10 per 1M input tokens
- ~$0.40 per 1M output tokens
- Typical feedback: ~200 tokens = **$0.00002 per feedback**

## Tech Stack

- React 18+
- Next.js 13+ (App Router)
- Supabase (PostgreSQL + Storage)
- Google Gemini 2.5 Flash Lite
- Resend (optional, for emails)

## Health endpoint

A liveness/readiness probe for load balancers and uptime monitors. Mount via:

```ts
// app/api/feedback/health/route.ts
export { feedbackHealthGET as GET } from 'openfeedbacklayer/server'
```

`GET /api/feedback/health` always returns `200` with the configured-integration matrix:

```json
{
  "status": "ok",
  "integrations": {
    "supabase": true,
    "gemini": true,
    "github": true,
    "resend": true,
    "webhook_secret": false
  },
  "timestamp": "2026-05-20T18:45:00.000Z"
}
```

No secrets are leaked — only presence/absence of each env var.

## Programmatic POSTs (JSON)

`POST /api/feedback` accepts **either** `multipart/form-data` (what the React widget sends so it can carry a screenshot) **or** `application/json` (what the CLI, CI, and AI-agent callers prefer):

```bash
curl -X POST https://your-app.com/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"message":"Dark mode broken","email":"you@x.com","subscribe":true}'
```

Same fields either way: `message` (required), `website` (honeypot — leave empty), `email`, `subscribe`, `project`. Screenshots are multipart-only (binary).

## CLI

The widget ships with a CLI for non-browser submissions — useful from CI,
shell scripts, or AI agents that need to file feedback against a deployed
endpoint without rendering React.

```bash
# Quick send (uses OFL_API_URL or defaults to http://localhost:3000/api/feedback)
npx openfeedbacklayer send "Dark-mode toggle is broken on the settings page."

# With email + subscribe to journey updates
npx openfeedbacklayer send "Export hangs at 90%" \
  --email you@example.com --subscribe

# Pipe from stdin (great for piping AI-agent output or log snippets)
echo "Sync failed after upgrade to 0.7.2" | npx openfeedbacklayer send

# Aim at a non-local endpoint
npx openfeedbacklayer send "..." --api-url https://app.example.com/api/feedback

# Get machine-readable JSON (id, ai_data, github_issue_url, ...)
npx openfeedbacklayer send "..." --json
```

Env vars: `OFL_API_URL`, `OFL_EMAIL`, `OFL_PROJECT`. Exit codes: `0` success,
`1` usage error, `2` network error, `3` server error. Run
`npx openfeedbacklayer --help` for the full reference.

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss changes.

---

Made with ❤️ by [SCAILE Technologies](https://scaile.tech)
