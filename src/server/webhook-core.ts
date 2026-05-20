import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  stageFromGitHubEvent,
  verifyGitHubSignature,
} from '../lib/github-service'
import { sendStageEmail } from '../lib/subscriber-email'
import type { JourneyStage } from '../lib/types'
import type { ServerEnv } from './feedback-core'

export interface WebhookDeps {
  supabase: SupabaseClient
  env: ServerEnv
  sendStage: typeof sendStageEmail
}

let supabaseAdmin: ReturnType<typeof createClient> | null = null

function getSupabaseAdmin(env: ServerEnv) {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      env.SUPABASE_URL!,
      env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }

  return supabaseAdmin
}

export function realDeps(env: ServerEnv = process.env): WebhookDeps {
  return {
    supabase: getSupabaseAdmin(env),
    env,
    sendStage: sendStageEmail,
  }
}

const STAGE_RANK: Record<JourneyStage, number> = {
  received: 0,
  triaged: 1,
  in_progress: 2,
  shipped: 3,
  wont_fix: 3,
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init)
}

export async function handleWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const raw = await request.text()
  const secret = deps.env.GITHUB_WEBHOOK_SECRET

  if (!secret || !verifyGitHubSignature(secret, raw, request.headers.get('x-hub-signature-256'))) {
    return json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    if (request.headers.get('x-github-event') !== 'issues') {
      return json({ ignored: true })
    }

    const payload = JSON.parse(raw)
    const stage = stageFromGitHubEvent(payload)

    if (!stage) {
      return json({ ignored: true })
    }

    const repoFullName = payload.repository?.full_name
    if (!repoFullName) {
      return json({ ignored: true })
    }

    if (deps.env.GITHUB_FEEDBACK_REPO && repoFullName !== deps.env.GITHUB_FEEDBACK_REPO) {
      return json({ ignored: true })
    }

    const { data: feedback, error } = await deps.supabase
      .from('feedback')
      .select('id, submitter_email, subscribe, github_issue_url, journey_stage, last_emailed_stage, ai_data')
      .eq('github_repo', repoFullName)
      .eq('github_issue_number', payload.issue.number)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!feedback || !feedback.subscribe || !feedback.submitter_email) {
      return json({ ignored: true })
    }

    if (feedback.last_emailed_stage === stage) {
      return json({ duplicate: true })
    }

    const currentStage = (feedback.journey_stage || 'received') as JourneyStage
    if (STAGE_RANK[stage] <= STAGE_RANK[currentStage]) {
      return json({ ignored: true })
    }

    const resendKey = deps.env.RESEND_API_KEY
    if (!resendKey) {
      return json({ ignored: true })
    }

    // Atomic single-statement claim via RPC. A prior approach used
    // .update().or(last_emailed_stage.is.null,...) but PostgREST rejects an
    // `or` filter on a mutation (HTTP 400, SQLSTATE 42703), so it never
    // advanced the stage against real Supabase. The function uses
    // `IS DISTINCT FROM` so NULL and non-null are handled in one atomic UPDATE.
    const { data: claim, error: claimError } = await deps.supabase
      .rpc('claim_feedback_stage', { p_id: feedback.id, p_stage: stage })

    if (claimError) {
      throw claimError
    }

    if (!claim || claim.length !== 1) {
      return json({ duplicate: true })
    }

    await deps.sendStage({
      resendKey,
      from: deps.env.RESEND_FROM_EMAIL || 'feedback@yourdomain.com',
      to: feedback.submitter_email,
      stage,
      issueNumber: payload.issue.number,
      issueUrl: feedback.github_issue_url || payload.issue.html_url,
      title: feedback.ai_data?.title || payload.issue.title,
    })

    return json({ ok: true })
  } catch (error) {
    console.error('[OpenFeedbackLayer] GitHub webhook error:', error)
    return json({ ok: true })
  }
}
