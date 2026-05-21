import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { analyzeFeedback } from '../lib/ai-service'
import { createFeedbackIssue, type CreateFeedbackIssueParams } from '../lib/github-service'
import { sendConfirmationEmail } from '../lib/subscriber-email'
import type { FeedbackAIData } from '../lib/types'

export type ServerEnv = Record<string, string | undefined>

export interface FeedbackDeps {
  supabase: SupabaseClient
  env: ServerEnv
  analyze: typeof analyzeFeedback
  createIssue: (params: CreateFeedbackIssueParams) => Promise<{ number: number; url: string } | null>
  sendConfirmation: typeof sendConfirmationEmail
}

// Module-level singleton (best-effort, single-instance / long-lived containers).
// Trade-off: in serverless cold starts the client is recreated per process,
// which is fine; if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY rotate at
// runtime in a long-lived container, this cached client will go stale and the
// host must restart the process or replace getSupabaseAdmin via the deps
// injection point (realDeps is the public seam). For multi-tenant or env-
// rotating hosts, pass a freshly-created `supabase` into FeedbackDeps.
let supabaseAdmin: ReturnType<typeof createClient> | null = null

function getSupabaseAdmin(env: ServerEnv) {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)!,
      env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }

  return supabaseAdmin
}

export function realDeps(env: ServerEnv = process.env): FeedbackDeps {
  return {
    supabase: getSupabaseAdmin(env),
    env,
    analyze: analyzeFeedback,
    createIssue: createFeedbackIssue,
    sendConfirmation: sendConfirmationEmail,
  }
}

// SECURITY (two limitations to call out — Kimi round-3 P0):
//   1. The limiter keys on x-forwarded-for / x-real-ip, which are client-
//      supplied. It is only effective when this route runs behind a trusted
//      proxy/CDN (Vercel, Cloudflare, nginx) that OVERWRITES x-forwarded-for
//      with the real client IP. Direct exposure is trivially bypassable.
//   2. The store is in-memory per process. On serverless platforms (Vercel
//      Functions, Cloudflare Workers, AWS Lambda) every cold start gets a
//      fresh process, so the cap resets per invocation — the limiter is
//      effectively a no-op for sustained abuse. Production deployments
//      MUST front this route with a distributed limiter (Upstash Redis,
//      Cloudflare KV, Supabase row-counter, or platform-native rate-limit
//      middleware) before going public. This in-memory variant is best-
//      effort for single-instance / long-lived containers only.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10
const RATE_WINDOW = 60 * 1000

// Image magic-byte signatures. Server must verify these before trusting the
// client-supplied filename/MIME (Kimi round-3 P0 — stored XSS via .png that
// is actually HTML/JS served back from a public Supabase bucket).
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  // WebP: 52 49 46 46 .. .. .. .. 57 45 42 50  (RIFF....WEBP)
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp'
  return null
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init)
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }

  if (entry.count >= RATE_LIMIT) {
    return false
  }

  entry.count++
  return true
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Escape every user-derived field before HTML-interpolating it into the
// owner notification email. message_raw comes from the submitter, page_url
// from the request headers, and category/priority from Gemini output — all
// untrusted from the owner's inbox perspective. (Codex round-2 P1.)
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendNotificationEmail(
  env: ServerEnv,
  feedback: {
    id: string
    message_raw: string
    page_url: string
    ai_data: { suggested_category?: string; suggested_priority?: string } | null
  }
) {
  const resendKey = env.RESEND_API_KEY
  const notifyEmail = env.FEEDBACK_NOTIFY_EMAIL

  if (!resendKey || !notifyEmail) return

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(resendKey)

    const category = feedback.ai_data?.suggested_category || 'unknown'
    const priority = feedback.ai_data?.suggested_priority || 'medium'
    const emoji = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢'

    await resend.emails.send({
      from: env.RESEND_FROM_EMAIL || 'feedback@yourdomain.com',
      to: notifyEmail,
      subject: `${emoji} New Feedback: ${escapeHtml(category)}`,
      html: `
        <h2>New Feedback Received</h2>
        <p><strong>Category:</strong> ${escapeHtml(category)}</p>
        <p><strong>Priority:</strong> ${escapeHtml(priority)}</p>
        <p><strong>Page:</strong> ${escapeHtml(feedback.page_url)}</p>
        <hr>
        <p><strong>Message:</strong></p>
        <blockquote>${escapeHtml(feedback.message_raw).replace(/\n/g, '<br>')}</blockquote>
      `,
    })
  } catch (error) {
    console.error('[Feedback] Failed to send email:', error)
  }
}

export async function handleFeedback(request: Request, deps: FeedbackDeps): Promise<Response> {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
               request.headers.get('x-real-ip') || 'unknown'

    if (!checkRateLimit(ip)) {
      return json({ error: 'Too many requests' }, { status: 429 })
    }

    // Accept both multipart/form-data (browser widget) and
    // application/json (CLI / agents / CI / curl). The widget always
    // sends multipart for the screenshot path, but programmatic callers
    // expect the standard JSON body. Without this branch they'd crash
    // on request.formData() with an unhelpful 500 (Kimi virgin-test P1).
    const contentType = request.headers.get('content-type') || ''
    let honeypot: string | null = null
    let messageRaw = ''
    let projectId: string | null = null
    let rawEmail = ''
    let subscribeFlag = false
    let screenshot: File | null = null

    if (contentType.includes('application/json')) {
      let body: Record<string, unknown>
      try {
        body = (await request.json()) as Record<string, unknown>
      } catch {
        return json({ error: 'Invalid JSON' }, { status: 400 })
      }
      honeypot = typeof body.website === 'string' ? body.website : null
      messageRaw = typeof body.message === 'string' ? body.message : ''
      projectId = typeof body.project === 'string' ? body.project : null
      rawEmail = typeof body.email === 'string' ? body.email.trim() : ''
      subscribeFlag = body.subscribe === true || body.subscribe === 'true'
      // Screenshots over JSON aren't supported (binary in JSON would need
      // base64 + a separate decode path); CLI/agent callers don't
      // typically attach screenshots anyway.
      screenshot = null
    } else {
      const formData = await request.formData()
      honeypot = formData.get('website') as string | null
      messageRaw = (formData.get('message') as string) || ''
      projectId = (formData.get('project') as string) || null
      rawEmail = ((formData.get('email') as string) || '').trim()
      subscribeFlag = formData.get('subscribe') === 'true'
      screenshot = formData.get('screenshot') as File | null
    }

    if (honeypot && honeypot.trim().length > 0) {
      console.log('[Feedback] Bot detected via honeypot')
      return json({ id: 'fake-id', message: 'Feedback sent' })
    }

    const submitterEmail = rawEmail && isValidEmail(rawEmail) ? rawEmail : null
    const subscribe = Boolean(submitterEmail && subscribeFlag)

    if (!messageRaw?.trim()) {
      return json({ error: 'Message is required' }, { status: 400 })
    }

    const pageUrl = request.headers.get('x-page-url') || request.headers.get('referer') || 'unknown'
    const userAgent = request.headers.get('user-agent') || null

    let screenshotUrl: string | null = null
    let screenshotBase64: string | null = null

    if (screenshot && screenshot.size > 0) {
      // SECURITY: server-side magic-byte sniff (do not trust the client-
      // supplied MIME or filename extension). Upload to a public storage
      // bucket where the file may be served back to other users; a .png
      // that is actually HTML/JS is a stored-XSS vector. (Kimi round-3 P0.)
      // Also enforce a server-side size cap so the client's 5MB check
      // can't be bypassed by a forged multipart request.
      const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
      if (screenshot.size > MAX_SCREENSHOT_BYTES) {
        return json({ error: 'Screenshot too large' }, { status: 413 })
      }
      const buffer = Buffer.from(await screenshot.arrayBuffer())
      const sniffed = sniffImageMime(buffer)
      if (!sniffed) {
        return json({ error: 'Unsupported screenshot type' }, { status: 415 })
      }
      const ext = sniffed.split('/')[1]
      const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`

      const { data: uploadData, error: uploadError } = await deps.supabase
        .storage
        .from('feedback')
        .upload(filename, buffer, {
          contentType: sniffed,
          cacheControl: '3600',
        })

      if (!uploadError && uploadData) {
        const { data: urlData } = deps.supabase
          .storage
          .from('feedback')
          .getPublicUrl(filename)
        screenshotUrl = urlData.publicUrl
      }

      screenshotBase64 = `data:${sniffed};base64,${buffer.toString('base64')}`
    }

    let aiData: FeedbackAIData | null = null
    const openaiKey = deps.env.OPENAI_API_KEY
    const geminiKey = deps.env.GEMINI_API_KEY
    if (openaiKey || geminiKey) {
      // AI classification is an optional enrichment step. A provider
      // failure (timeout, rate limit, malformed JSON) must NOT 500 the
      // user's feedback after their screenshot is uploaded and their row
      // is about to be inserted. Catch internally, log, fall back to
      // aiData=null. OpenAI is preferred when its key is set (the Gemini
      // free tier caps at 20 req/day). (Kimi round-4 P1.)
      try {
        aiData = await deps.analyze({
          messageRaw,
          screenshotBase64: screenshotBase64 || undefined,
          openaiApiKey: openaiKey,
          openaiModel: deps.env.OPENAI_MODEL,
          geminiApiKey: geminiKey,
        })
      } catch (error) {
        console.error('[Feedback] AI classification failed; continuing without:', error)
        aiData = null
      }
    }

    const { data: feedback, error } = await deps.supabase
      .from('feedback')
      .insert({
        page_url: pageUrl,
        user_agent: userAgent,
        message_raw: messageRaw,
        screenshot_url: screenshotUrl,
        ai_data: aiData,
        project_id: projectId,
        status: 'new',
        submitter_email: submitterEmail,
        subscribe,
        journey_stage: 'received',
      })
      .select('id')
      .single()

    if (error || !feedback) {
      // PostgrestError carries .message / .code / .details / .hint as
      // non-enumerable properties, so the default console.error of the
      // object renders as `{}` and hides the actual cause. Spread the
      // useful fields so dev logs are debuggable when supabase-js fails.
      const errAny = error as unknown as Record<string, unknown> | null
      console.error('[Feedback] Database error:', {
        errorIsNull: error === null,
        feedbackIsNull: !feedback,
        message: errAny?.message,
        code: errAny?.code,
        details: errAny?.details,
        hint: errAny?.hint,
        status: errAny?.status,
        name: errAny?.name,
        errorKeys: errAny ? Object.keys(errAny) : null,
        errorJSON: errAny ? JSON.stringify(errAny, Object.getOwnPropertyNames(errAny)) : null,
      })
      return json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    let githubIssue: { number: number; url: string } | null = null
    const githubToken = deps.env.GITHUB_TOKEN
    const githubRepo = deps.env.GITHUB_FEEDBACK_REPO

    if (githubToken && githubRepo) {
      githubIssue = await deps.createIssue({
        token: githubToken,
        repo: githubRepo,
        aiData,
        messageRaw,
        pageUrl,
        screenshotUrl,
      })

      if (githubIssue) {
        const { error: updateError } = await deps.supabase
          .from('feedback')
          .update({
            github_issue_number: githubIssue.number,
            github_issue_url: githubIssue.url,
            github_repo: githubRepo,
          })
          .eq('id', feedback.id)

        if (updateError) {
          console.error('[Feedback] GitHub issue update error:', updateError)
        }
      }
    }

    const resendKey = deps.env.RESEND_API_KEY
    const resendFrom = deps.env.RESEND_FROM_EMAIL || 'feedback@yourdomain.com'

    if (submitterEmail && subscribe && resendKey && githubIssue) {
      try {
        await deps.sendConfirmation({
          resendKey,
          from: resendFrom,
          to: submitterEmail,
          issueNumber: githubIssue.number,
          issueUrl: githubIssue.url,
          title: aiData?.title || messageRaw.slice(0, 60),
        })
      } catch (error) {
        console.error('[Feedback] Failed to send confirmation email:', error)
      }
    }

    await sendNotificationEmail(deps.env, {
      id: feedback.id,
      message_raw: messageRaw,
      page_url: pageUrl,
      ai_data: aiData,
    })

    return json({
      id: feedback.id,
      ai_data: aiData,
      github_issue_number: githubIssue?.number ?? null,
      github_issue_url: githubIssue?.url ?? null,
      message: 'Feedback received',
    })
  } catch (error) {
    console.error('[Feedback] Error:', error)
    return json({ error: 'Internal server error' }, { status: 500 })
  }
}
