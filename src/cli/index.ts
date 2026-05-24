#!/usr/bin/env node
/**
 * openfeedbacklayer CLI
 *
 * Lets users (and CI / agents) submit feedback to a deployed
 * openfeedbacklayer endpoint without a browser. Same wire protocol as the
 * widget: multipart POST to /api/feedback. Same server-side path: PII
 * redaction, AI classification, GitHub issue creation, owner notification.
 *
 * Usage:
 *   npx openfeedbacklayer send "your message"
 *   npx openfeedbacklayer send "your message" --email you@example.com --subscribe
 *   npx openfeedbacklayer send "your message" --api-url https://floom.dev/api/feedback
 *   echo "message from stdin" | npx openfeedbacklayer send
 *
 * Env defaults:
 *   OFL_API_URL      base URL of the feedback endpoint (default http://localhost:3000/api/feedback)
 *   OFL_EMAIL        default submitter email
 *   OFL_PROJECT      default projectId (multi-project setups)
 *
 * Exit codes:
 *   0 ok          POST returned 2xx
 *   1 usage       missing message / bad flag
 *   2 network     fetch failed (DNS, refused, timeout)
 *   3 server      non-2xx response from the endpoint
 */

import { readFileSync } from 'node:fs'

interface CliFlags {
  apiUrl: string
  email?: string
  subscribe: boolean
  projectId?: string
  json: boolean
}

const DEFAULTS = {
  apiUrl: process.env.OFL_API_URL || 'http://localhost:3000/api/feedback',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: CliFlags } {
  const flags: CliFlags = {
    apiUrl: DEFAULTS.apiUrl,
    email: process.env.OFL_EMAIL,
    subscribe: false,
    projectId: process.env.OFL_PROJECT,
    json: false,
  }
  const positional: string[] = []
  let cmd = ''

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    // Top-level shortcuts work in any position so `npx openfeedbacklayer
    // --help` and `npx openfeedbacklayer --version` behave like every
    // other Unix CLI rather than printing "unknown command".
    if (arg === '--help' || arg === '-h') {
      cmd = 'help'
      continue
    }
    if (arg === '--version' || arg === '-v') {
      cmd = 'version'
      continue
    }
    if (!cmd) {
      cmd = arg
      continue
    }
    if (arg === '--api-url') {
      flags.apiUrl = argv[++i] || flags.apiUrl
    } else if (arg.startsWith('--api-url=')) {
      flags.apiUrl = arg.slice('--api-url='.length)
    } else if (arg === '--email') {
      flags.email = argv[++i]
    } else if (arg.startsWith('--email=')) {
      flags.email = arg.slice('--email='.length)
    } else if (arg === '--subscribe') {
      flags.subscribe = true
    } else if (arg === '--no-subscribe') {
      flags.subscribe = false
    } else if (arg === '--project') {
      flags.projectId = argv[++i]
    } else if (arg.startsWith('--project=')) {
      flags.projectId = arg.slice('--project='.length)
    } else if (arg === '--json') {
      flags.json = true
    } else {
      positional.push(arg)
    }
  }

  return { cmd, positional, flags }
}

function printHelp(): void {
  process.stdout.write(`openfeedbacklayer — send feedback from the CLI

Usage
  npx openfeedbacklayer send "your message" [options]
  echo "message" | npx openfeedbacklayer send [options]

Commands
  send            POST a feedback message to a deployed endpoint
  version         Print version and exit
  help            Show this help

Options
  --api-url URL   Endpoint URL (env: OFL_API_URL, default ${DEFAULTS.apiUrl})
  --email EMAIL   Submitter email (env: OFL_EMAIL)
  --subscribe     Subscribe the email to journey updates
  --project ID    Project ID for multi-project setups (env: OFL_PROJECT)
  --json          Print the server response as JSON
  -h, --help      Show this help
  -v, --version   Show version

Exit codes
  0  ok           POST returned 2xx
  1  usage        missing message / bad flag
  2  network      fetch failed (DNS, refused, timeout)
  3  server       non-2xx response from the endpoint
`)
}

async function readMessageFromArgsOrStdin(positional: string[]): Promise<string> {
  if (positional.length > 0) {
    return positional.join(' ')
  }
  if (process.stdin.isTTY) return ''
  // Read piped stdin
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

interface ServerResponse {
  id?: string
  ai_data?: { title?: string; short_summary?: string } | null
  github_issue_number?: number | null
  github_issue_url?: string | null
  email_warning?: string
  error?: string
}

async function runSend(positional: string[], flags: CliFlags): Promise<number> {
  const message = await readMessageFromArgsOrStdin(positional)
  if (!message) {
    process.stderr.write('Error: no message. Pass it as an argument or pipe it on stdin.\n\n')
    printHelp()
    return 1
  }

  const email = flags.email?.trim()
  if (flags.email && (!email || !EMAIL_RE.test(email))) {
    process.stderr.write(`Error: invalid email address: ${flags.email}\n`)
    return 1
  }

  // Send as application/json by default — cleaner wire format than
  // multipart for the CLI's purposes (no screenshots, no binary data),
  // and easier to debug with curl. The server accepts both.
  const reqBody: Record<string, unknown> = {
    message,
    website: '', // honeypot (empty = real submission)
    subscribe: Boolean(flags.subscribe && email),
  }
  if (email) reqBody.email = email
  if (flags.projectId) reqBody.project = flags.projectId

  let res: Response
  try {
    res = await fetch(flags.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-page-url': 'cli' },
      body: JSON.stringify(reqBody),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Error: could not reach ${flags.apiUrl}\n  ${msg}\n`)
    return 2
  }

  let resBody: ServerResponse
  try {
    resBody = (await res.json()) as ServerResponse
  } catch {
    resBody = { error: `Non-JSON response (HTTP ${res.status})` }
  }

  if (!res.ok) {
    process.stderr.write(`Error: server returned HTTP ${res.status}: ${resBody.error || 'unknown'}\n`)
    if (flags.json) process.stderr.write(JSON.stringify(resBody, null, 2) + '\n')
    return 3
  }

  if (resBody.email_warning) {
    process.stderr.write(`Warning: ${resBody.email_warning}\n`)
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(resBody, null, 2) + '\n')
    return 0
  }

  // Human-readable. Mirrors the success-state synthesis of the widget:
  // confirm receipt, echo the user's words (as the title since we don't
  // re-echo the full input back), promise + GitHub tracking link.
  const aiTitle = resBody.ai_data?.title
  const issueLine =
    typeof resBody.github_issue_number === 'number'
      ? `  Tracked as issue #${resBody.github_issue_number}${
          resBody.github_issue_url ? ` — ${resBody.github_issue_url}` : ''
        }`
      : '  (No GitHub issue was created. GITHUB_TOKEN / GITHUB_FEEDBACK_REPO may be unset on the server.)'

  process.stdout.write(
    `\n  ✓ We got your message\n` +
      (aiTitle ? `    “${aiTitle}”\n` : '') +
      `\n  We'll review this within 1 day.\n` +
      `${issueLine}\n\n` +
      (flags.subscribe && email
        ? `  We'll email ${email} as the team triages it.\n\n`
        : ''),
  )
  return 0
}

function printVersion(): void {
  // Read sibling package.json so the version stays in sync with the lib.
  try {
    // The bundled file lives at <pkg-root>/dist/cli.mjs, so package.json
    // is one directory up. URL constructor with a file URL resolves the
    // leaf away first, so '../package.json' lands at <pkg-root>/package.json.
    const pkgPath = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    process.stdout.write(`openfeedbacklayer ${pkg.version || 'unknown'}\n`)
  } catch {
    process.stdout.write('openfeedbacklayer (version unknown)\n')
  }
}

async function main(): Promise<number> {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2))

  switch (cmd) {
    case '':
    case 'help':
      printHelp()
      return 0
    case 'version':
      printVersion()
      return 0
    case 'send':
      return runSend(positional, flags)
    default:
      process.stderr.write(`Error: unknown command "${cmd}"\n\n`)
      printHelp()
      return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(2)
  })
