# Surface — openfeedbacklayer (feat/feedback-journey)

Generated: 2026-05-19  
Repo SHA: $(git rev-parse --short HEAD)  
Deployed URL: http://65.21.90.216:3025/

## What this project is

A drop-in React feedback widget + Next.js API routes + Supabase migrations.
**This is a library**, not a webapp. The "deployed" URL is the
`examples/nextjs` reference app used for testing only — production deployment
is by host apps that install `openfeedbacklayer` from npm.

## Pages (examples/nextjs reference app — the only public surface)

- `GET /` — single demo page rendering the widget

## API routes (the actual feature surface)

- `POST /api/feedback` (multipart form):
  - fields: `message` (req), `email` (opt), `subscribe` (opt 'true'),
    `screenshot` (opt File ≤5MB), `project` (opt), `website` (honeypot — bots fill, real users don't)
  - headers: `x-page-url`, `referer`, `x-forwarded-for`, `x-real-ip`, `user-agent`
  - returns: `{id, ai_data, message}` 200 / `{error}` 400|429|500
  - chain on success: rate-limit -> honeypot -> screenshot upload -> Gemini classify -> Postgres insert -> Octokit create issue (if GITHUB_TOKEN+GITHUB_FEEDBACK_REPO) -> Resend owner notification (if FEEDBACK_NOTIFY_EMAIL) -> Resend submitter confirmation (if subscribe+RESEND_API_KEY+issue created)

- `POST /api/feedback/webhook` (application/json):
  - body: GitHub Issues event JSON
  - headers: `x-github-event: issues`, `x-hub-signature-256` (HMAC sha256)
  - returns: `{ok:true}` 200 / `{error:'Invalid signature'}` 401
  - chain: HMAC verify -> stage map (closed/labeled) -> row lookup by (github_repo, github_issue_number) -> forward-only RPC claim -> Resend stage email -> row update

## UI components (the widget)

- Floating bottom-right button (open/close)
- Popup form (320×~75vh):
  - Textarea (message, required)
  - Email input (optional, type=email)
  - Checkbox "Email me when this is addressed" (auto-checks when email typed; disabled when email empty)
  - Screenshot button (file picker) + paste/drag support
  - Send button (disabled until message non-empty)
  - Honeypot input (hidden via off-screen position, tabindex=-1, aria-hidden)
- Success state:
  - ✓ checkmark
  - AI summary text
  - "We'll email you at X with updates." (when subscribed)
  - Classification badges (category / feature_area / priority P0|P1|P2)
  - Close button

## MCP tools
None.

## CLI commands
None.

## Auth flows
- None on the widget itself (anonymous submission by design).
- API uses Supabase service_role JWT server-side only (never exposed to client).
- Webhook auth: GitHub HMAC sha256 only.

## Tech inventory

- Library: TypeScript, React 18 (peer), tsup build, Node ≥18
- Example app: Next.js 15.5.18 (App Router), React 18
- Backend: `@supabase/supabase-js` (peer), PostgREST 12.2.3, Postgres 16
- AI: `@google/generative-ai` 0.21 → Gemini 2.5 Flash Lite
- GitHub: `@octokit/rest` 21 (peer)
- Email: `resend` 4 (peer)
- Crypto: `node:crypto` for HMAC

## Personas (mapped to this surface)

- **anonymous-visitor** (the only real persona — widget is for end users on a host app)
- **mobile-visitor** — same widget on phone viewport
- **automated-bot** — fills the honeypot or floods the rate limiter
- **adversarial-submitter** — crafts message to leak PII to issue / inject markdown / phish via screenshot URL
- **github-webhook-sender** (real GitHub OR an attacker forging signed payloads)
- **integrator-developer** — npm-installs the package into their app (docs / DX persona)

## Tested categories

- Functional (widget submit chain end-to-end, real backend)
- Auth + security (HMAC, RPC privilege, redaction, defang, ordering, ReDoS, rate-limit)
- UI/UX (desktop + mobile screenshots, interaction)
- Performance (load time, AI call time)
- Data + DB (migration validity, journey state machine)
- Email (Gmail-receipt verified, both confirmation + stage)
- Documentation (README install + journey + security sections)
- Disaster (GitHub down → fail graceful, Resend down → still 200, dead key → no throw)

## N/A categories

- SEO + sharing — library, no public site
- Sandbox / runtime — no untrusted code execution
- Trust + brand — no logged-in account, no transactions
- Monitoring — no telemetry surface (consumers add their own)
