/**
 * GitHub issue helpers for feedback journey tracking.
 * Redaction is best-effort defense-in-depth, not a guarantee; issue bodies may
 * still contain user-typed content.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FeedbackAIData, JourneyStage } from './types'

export interface CreateFeedbackIssueParams {
  token: string
  repo: string
  aiData: FeedbackAIData | null
  messageRaw: string
  pageUrl: string
  screenshotUrl?: string | null
}

export interface FeedbackIssuePayload {
  owner: string
  repo: string
  title: string
  body: string
  labels: string[]
}

const UNSAFE_URL = '[screenshot omitted: unsafe URL]'
// All quantifiers are BOUNDED to defeat catastrophic backtracking (ReDoS).
// Email/domain regexes use \p{L} via /u so Unicode domains (例え.テスト) match.
// Phone keeps only the LEFT token boundary so digits glued to letters AFTER
// (5558675309x123, extensions) still redact, while letter-before IDs survive.
const KEY_VALUE_SECRET_RE = /\b(access_token|api_key|token|secret|password)=([^\s&"'<>)\]]{1,512})/gi
const HTTP_URL_RE = /https?:\/\/[^\s<>)\]]{1,2048}/gi
// Email local + domain classes include Unicode combining marks (\p{M}) so
// scripts like Arabic with diacritics (عَرَبِيّ@...) redact (Codex round 3 #1).
// TLD also accepts an A-label punycode form (xn--...).
const EMAIL_RE =
  /[\p{L}\p{M}\p{N}._%+-]{1,128}@[\p{L}\p{M}\p{N}.\-]{1,253}\.(?:xn--[A-Za-z0-9-]{1,30}|[\p{L}\p{M}]{2,24})/giu
const OBFUSCATED_EMAIL_RE =
  /\b[\p{L}\p{M}\p{N}._%+-]{1,128}\s{0,16}(?:\[?\(?\s{0,4}at\s{0,4}\)?\]?|\s{1,4}at\s{1,4})\s{0,16}[\p{L}\p{M}\p{N}.\-]{1,128}(?:\s{0,16}(?:\[?\(?\s{0,4}dot\s{0,4}\)?\]?|\s{1,4}dot\s{1,4})\s{0,16}[\p{L}\p{M}\p{N}\-]{1,64}){1,8}\b/giu
// Non-phone numeric formats that the broad phone candidate would otherwise
// eat (Codex round 3 #3). Tested in order BEFORE the digit-count threshold.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:[Zz]|[+\-]\d{2}:?\d{2})?)?$/
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const ISBN_RE = /^(?:97[89][-\s]?)?\d{1,5}[-\s]\d{1,7}[-\s]\d{1,7}[-\s][\dXx]$/
// NOTE: a bare-digit GTIN regex was tried but had to be removed: GTIN-8 and
// GTIN-12/13/14 lengths overlap with real phone numbers (e.g. 55512345 or
// +447911123456 without the +). Without context like the literal "GTIN" /
// "EAN" / "UPC" nearby, redacting wins; only hyphen-formatted ISBNs survive
// (the ISBN_RE pattern). Codex round 4 #2.
// Phone candidate: LEFT-only token boundary (?<![A-Za-z0-9]) so digits glued
// to letters BEFORE (CMB1779152387) survive as IDs, but digits-then-letters
// (5558675309x123 phone extension) still redact. Bounded quantifiers prevent
// ReDoS. The digitCount>=7 guard rejects accidental short runs.
// PHONE_CANDIDATE_RE uses \p{N} (Unicode digit) with /u so Arabic-Indic and
// Devanagari digits (e.g. ٥٥٥..., ५५...) redact like ASCII (Codex round 5 #1).
const PHONE_CANDIDATE_RE =
  /(?<![\p{L}\p{N}])\+?\p{N}(?:[\p{N}\s().\-[\]]{0,32}\p{N}){6,24}/gu
const NON_DIGIT_RE = /[^\p{N}]/gu
// Treat any SINGLE path segment that looks high-entropy (hex / base64 with
// optional padding / base32 padded) as a potential signed/token URL. Each
// alternative excludes `/` so legitimate multi-segment paths like
// /storage/v1/object/public/feedback/<file>.png are not falsely flagged
// (Codex round 6 #1 regression on round 5 #2's overly-greedy class).
const HIGH_ENTROPY_PATH_SEGMENT_RE =
  /(?:^|\/)(?:[A-Fa-f0-9]{24,}|[A-Za-z0-9_-]{24,}=*|[A-Za-z0-9_+=]{24,}=*)(?:\.[A-Za-z0-9]+)?(?:\/|$)/
const PERCENT_ENCODED_PATH_RE = /%[0-9A-Fa-f]{2}/

function redactKeyValueSecrets(value: string): string {
  return value.replace(KEY_VALUE_SECRET_RE, '$1=[redacted]')
}

function hasUnsafePathToken(pathname: string): boolean {
  // Percent-encoded characters in the path almost always indicate a signed
  // / pre-auth URL with secret material; treat as unsafe regardless of
  // entropy heuristics (Codex round 5 #2).
  if (PERCENT_ENCODED_PATH_RE.test(pathname)) return true
  return HIGH_ENTROPY_PATH_SEGMENT_RE.test(pathname)
}

// Markdown `![alt](url)` is terminated by `)`, and brackets/parens inside
// `url` enable image-injection breakouts. Encode them defensively before
// embedding the URL in markdown (Codex round 6 #3).
function encodeMarkdownUnsafeUrl(url: string): string {
  return url
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
    .replace(/\s/g, '%20')
}

function sanitizeUrl(value: string): string {
  const normalized = value.normalize('NFKC')

  try {
    const url = new URL(normalized)

    // Only http(s) URLs are renderable as images / autolinks. data:,
    // javascript:, mailto:, ftp:, etc. must NOT survive into the issue body
    // even as text (the secret payload would leak; Codex round 6 #2).
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return UNSAFE_URL
    }

    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''

    if (hasUnsafePathToken(url.pathname)) {
      return UNSAFE_URL
    }

    // Clean URL (origin + path only). URL autolink defanging happens later
    // in defangMarkdown (after stripControl). For markdown contexts that
    // embed this in `](url)`, callers should also run encodeMarkdownUnsafeUrl.
    return `${url.origin}${url.pathname}`
  } catch {
    return UNSAFE_URL
  }
}

// Strip C0/C1 control chars (keep \n \t) and Unicode bidi/format overrides
// (Trojan-Source), then neutralize GitHub markdown so untrusted feedback text
// cannot ping users (@mention), cross-reference / auto-close issues (#123),
// break layout with fenced blocks, or inject HTML (img/details/links). A
// zero-width space after the trigger keeps the text human-readable while
// defeating GitHub's parser. Applied to every user-derived field because they
// all route through redactSensitive.
// Strip ALL Unicode Cc (control) + Cf (format) plus U+2028/U+2029, but
// PRESERVE \n and \t. Catches U+180E, U+2060, U+E0000-E007F tag chars,
// every bidi/format codepoint defined now or later (Codex review #4).
const CONTROL_FORMAT_RE = /[\p{Cc}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu
function stripControl(value: string): string {
  return value.replace(CONTROL_FORMAT_RE, (c) => (c === '\n' || c === '\t' ? c : ''))
}
const ZWSP = '\u200B'
// Unicode dot variants (ideographic / fullwidth / halfwidth) that bypass an
// ASCII-dot email regex unless canonicalized (Codex review #3).
const DOT_VARIANTS_RE = /[\u3002\uFF0E\uFF61]/g
// Bound expensive regex passes against pathological inputs as defense in
// depth against ReDoS (alongside bounded quantifiers; Codex review #1).
const MAX_REDACT_INPUT = 8 * 1024

function defangMarkdown(value: string): string {
  // NOTE: stripControl runs in redactSensitive BEFORE the regex pipeline now
  // (Codex round 4 #1). defangMarkdown only INSERTS defender ZWSPs after that,
  // so we must NOT strip again here - that would remove our own defang markers.
  return value
    .replace(/@(?=[A-Za-z0-9_-])/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`)
    .replace(/`/g, `\`${ZWSP}`)
    // Defang GitHub's bare-URL autolinker by inserting a zero-width space
    // after the scheme of any surviving URL. Done HERE (post-stripControl)
    // so our own ZWSP markers are not removed by Cf stripping. Also defang
    // bare www.* (GitHub auto-prefixes http:// for those) per Codex round 3 #2.
    .replace(/(https?:)\/\//gi, `$1${ZWSP}//`)
    .replace(/\b(www)\./gi, `$1${ZWSP}.`)
    // Break inline link / image syntax [text](url) and ![alt](url): the
    // `](` join is what GitHub renders as a clickable link or remote image
    // (phishing / tracking pixel). A zero-width space defangs it; `](` is
    // vanishingly rare in genuine prose.
    .replace(/\]\(/g, `]${ZWSP}(`)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function redactSensitive(value: string): string {
  // Pipeline order matters for security (Codex round 4 #1 was an ordering
  // bug). Sequence:
  //   1. NFKC normalize  (canonicalize Unicode forms)
  //   2. stripControl    (remove attacker-supplied controls / default-
  //                       ignorables - must happen BEFORE the redaction
  //                       regexes; otherwise an embedded U+200B inside
  //                       `leak@example.​com` makes EMAIL_RE miss, and a
  //                       later strip in defangMarkdown leaves the email)
  //   3. cap length      (post-normalize, post-strip; Codex round 3 #4)
  //   4. dot variants -> URL -> email -> phone (regex redaction passes)
  //   5. defangMarkdown  (inserts DEFENDER ZWSPs at @, #, `, ](, http(s)://,
  //                       www. - must NOT strip again, see defangMarkdown)
  const stripped = stripControl(value.normalize('NFKC'))
  const capped = stripped.length > MAX_REDACT_INPUT ? stripped.slice(0, MAX_REDACT_INPUT) : stripped
  return defangMarkdown(
    redactKeyValueSecrets(
      capped
        // Canonicalize Unicode dot variants so Unicode-domain emails like
        // user@example。com (U+3002) and user@x．y (U+FF0E) match the email
        // regex (Codex #3). NFKC alone does not normalize U+3002 (already
        // applied to `capped` above).
        .replace(DOT_VARIANTS_RE, '.')
        .replace(HTTP_URL_RE, (url) => sanitizeUrl(url))
        .replace(EMAIL_RE, '[redacted email]')
        .replace(OBFUSCATED_EMAIL_RE, '[redacted email]')
        .replace(PHONE_CANDIDATE_RE, (candidate) => {
          // Skip shapes that look like ISO dates, IPv4, ISBN, GTIN/EAN
          // before applying the digit-count phone test (Codex round 3 #3).
          const t = candidate.trim()
          if (ISO_DATE_RE.test(t) || IPV4_RE.test(t) || ISBN_RE.test(t)) {
            return candidate
          }
          const digitCount = candidate.replace(NON_DIGIT_RE, '').length
          return digitCount >= 7 ? '[redacted phone]' : candidate
        }),
    ),
  )
}

function safePageUrl(pageUrl: string): string {
  return redactSensitive(sanitizeUrl(pageUrl))
}

function markdownList(items: string[]): string {
  return items.map((item) => `- ${redactSensitive(item)}`).join('\n')
}

function buildIssueBody(params: CreateFeedbackIssueParams): string {
  const { aiData, messageRaw, pageUrl, screenshotUrl } = params
  const body = [
    '## Summary',
    redactSensitive(aiData?.short_summary || 'New feedback received.'),
    '',
    '## Original message',
    `> ${redactSensitive(messageRaw).replace(/\n/g, '\n> ')}`,
    '',
    '## Key details',
    aiData?.key_details?.length ? markdownList(aiData.key_details) : '- None provided',
  ]

  if (aiData?.steps?.length) {
    body.push('', '## Steps', markdownList(aiData.steps))
  }

  if (aiData?.expected) {
    body.push('', '## Expected', redactSensitive(aiData.expected))
  }

  body.push('', '## Page URL', safePageUrl(pageUrl))

  if (screenshotUrl) {
    const safeScreenshotUrl = sanitizeUrl(screenshotUrl)
    body.push(
      '',
      '## Screenshot',
      safeScreenshotUrl === UNSAFE_URL
        ? UNSAFE_URL
        : `![Feedback screenshot](${encodeMarkdownUnsafeUrl(safeScreenshotUrl)})`,
    )
  }

  body.push('', '_Filed via OpenFeedbackLayer_')

  return body.join('\n')
}

export function buildFeedbackIssuePayload(params: CreateFeedbackIssueParams): FeedbackIssuePayload {
  const [owner, name] = params.repo.split('/')
  if (!owner || !name) {
    throw new Error('GITHUB_FEEDBACK_REPO must use owner/name format')
  }

  const fallbackTitle = redactSensitive(params.messageRaw).slice(0, 60) || 'New feedback'
  const title = redactSensitive(params.aiData?.title || fallbackTitle)
  const labels = [
    'feedback',
    `category:${params.aiData?.suggested_category || 'other'}`,
    `priority:${params.aiData?.suggested_priority || 'medium'}`,
  ]

  return {
    owner,
    repo: name,
    title,
    body: buildIssueBody(params),
    labels,
  }
}

export async function createFeedbackIssue({
  token,
  repo,
  aiData,
  messageRaw,
  pageUrl,
  screenshotUrl,
}: CreateFeedbackIssueParams): Promise<{ number: number; url: string } | null> {
  try {
    const issuePayload = buildFeedbackIssuePayload({ token, repo, aiData, messageRaw, pageUrl, screenshotUrl })

    const { Octokit } = await import('@octokit/rest')
    const octokit = new Octokit({ auth: token })

    const issue = await octokit.rest.issues.create({
      owner: issuePayload.owner,
      repo: issuePayload.repo,
      title: issuePayload.title,
      body: issuePayload.body,
      labels: issuePayload.labels,
    })

    return {
      number: issue.data.number,
      url: issue.data.html_url,
    }
  } catch (error) {
    console.error('[OpenFeedbackLayer] Failed to create GitHub issue:', error)
    return null
  }
}

export function stageFromGitHubEvent(event: {
  action: string
  label?: { name: string }
  issue: { state: string; state_reason?: string | null }
}): JourneyStage | null {
  if (event.action === 'closed') {
    return event.issue.state_reason === 'not_planned' ? 'wont_fix' : 'shipped'
  }

  if (event.action === 'labeled') {
    const label = event.label?.name.toLowerCase().trim()
    if (label === 'triaged') return 'triaged'
    if (label === 'in progress' || label === 'in-progress' || label === 'wip') {
      return 'in_progress'
    }
  }

  return null
}

export function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null
): boolean {
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false

  const signature = signatureHeader.slice('sha256='.length)
  if (!/^[a-f0-9]+$/i.test(signature)) return false

  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex')
  const received = Buffer.from(signature, 'hex')

  if (expected.length !== received.length) return false

  return timingSafeEqual(expected, received)
}
