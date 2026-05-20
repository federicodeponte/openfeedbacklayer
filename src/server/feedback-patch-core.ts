import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { analyzeFeedback, refineFeedback } from '../lib/ai-service'
import type { FeedbackAIData } from '../lib/types'
import type { ServerEnv } from './feedback-core'

/**
 * PATCH /api/feedback/[id] — let the original submitter (within their own
 * success-state session) change subscribe, add an email after the fact,
 * and send a follow-up clarification that re-runs the AI classification
 * + summary.
 *
 * Trust model: anyone who knows the feedback row's UUID can mutate the
 * whitelisted fields. The UUID is only ever returned to the submitter
 * (in the POST /api/feedback response) and never leaked to GitHub or the
 * webhook payload, so an attacker would need to guess a v4 UUID to abuse
 * this. Acceptable for v0; future hardening = short-lived signed edit
 * token returned with the POST response.
 *
 * Whitelist of mutable fields (everything else is rejected):
 *   - subscribe: boolean
 *   - submitter_email: string (valid email; supports adding an email
 *     after the initial submit if the submitter skipped it)
 *   - follow_up: string (1-2000 chars) — submitter's "you got X wrong,
 *     I actually meant Y" clarification. Server re-runs Gemini against
 *     (original message + prior aiData + this follow-up) and overwrites
 *     ai_data with the corrected pass. Returns the new ai_data.
 */

export interface PatchFeedbackDeps {
  supabase: SupabaseClient
  env: ServerEnv
  /** Injection point for the refine call so tests can stub Gemini. */
  refine: typeof refineFeedback
  /** Fallback path when there's no prior aiData (e.g. Gemini was 503'd
   *  on submit): we classify the combined (original + follow-up) text
   *  fresh instead of refining a non-existent prior. */
  analyze: typeof analyzeFeedback
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FOLLOW_UP_MAX_LEN = 2000

let supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin(env: ServerEnv) {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient((env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)!, env.SUPABASE_SERVICE_ROLE_KEY!)
  }
  return supabaseAdmin
}

export function realPatchDeps(env: ServerEnv = process.env): PatchFeedbackDeps {
  return {
    supabase: getSupabaseAdmin(env),
    env,
    refine: refineFeedback,
    analyze: analyzeFeedback,
  }
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init)
}

export async function handlePatch(
  request: Request,
  id: string,
  deps: PatchFeedbackDeps,
): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Whitelist + validate
  const updates: Record<string, unknown> = {}
  let followUp: string | null = null

  if (body.subscribe !== undefined) {
    if (typeof body.subscribe !== 'boolean') {
      return json({ error: 'subscribe must be boolean' }, { status: 400 })
    }
    updates.subscribe = body.subscribe
  }

  if (body.submitter_email !== undefined) {
    if (typeof body.submitter_email !== 'string') {
      return json({ error: 'submitter_email must be string' }, { status: 400 })
    }
    const email = body.submitter_email.trim()
    if (email === '') {
      // Allow clearing the email (and implicitly cancels future subscriber emails)
      updates.submitter_email = null
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return json({ error: 'invalid submitter_email' }, { status: 400 })
    } else {
      updates.submitter_email = email
    }
  }

  if (body.follow_up !== undefined) {
    if (typeof body.follow_up !== 'string') {
      return json({ error: 'follow_up must be string' }, { status: 400 })
    }
    const trimmed = body.follow_up.trim()
    if (trimmed.length < 1 || trimmed.length > FOLLOW_UP_MAX_LEN) {
      return json({ error: `follow_up must be 1-${FOLLOW_UP_MAX_LEN} chars` }, { status: 400 })
    }
    followUp = trimmed
  }

  if (Object.keys(updates).length === 0 && followUp === null) {
    return json({ error: 'No mutable fields supplied' }, { status: 400 })
  }

  try {
    // Refine path: re-run Gemini against (original message + prior aiData +
    // follow-up) and overwrite ai_data with the corrected pass. We always
    // need to load the row first so we have message_raw + prior aiData.
    if (followUp !== null) {
      const { data: existing, error: readErr } = await deps.supabase
        .from('feedback')
        .select('message_raw, ai_data')
        .eq('id', id)
        .maybeSingle()
      if (readErr) throw readErr
      if (!existing) return json({ error: 'Not found' }, { status: 404 })

      const geminiApiKey = deps.env.GEMINI_API_KEY
      if (!geminiApiKey) {
        return json({ error: 'AI refinement is not configured on this deployment' }, { status: 503 })
      }

      const prior = (existing.ai_data as FeedbackAIData | null) || null
      const messageRaw = (existing.message_raw as string | null) || ''
      // If we have a prior aiData, ask the model to CORRECT it given the
      // follow-up. Otherwise (Gemini was 503'd on submit, or the env didn't
      // have GEMINI_API_KEY then) classify (original + follow-up) fresh —
      // returning a 409 here would dead-end the user with no recourse.
      const refined = prior
        ? await deps.refine({ messageRaw, followUp, prior, geminiApiKey })
        : await deps.analyze({
            messageRaw: `${messageRaw}\n\n[Submitter follow-up]: ${followUp}`,
            geminiApiKey,
          })

      if (!refined) {
        return json(
          { error: 'AI refinement failed - please try again or rephrase' },
          { status: 502 },
        )
      }

      updates.ai_data = refined
    }

    const { data, error } = await deps.supabase
      .from('feedback')
      .update(updates)
      .eq('id', id)
      .select('id, subscribe, ai_data')
      .maybeSingle()

    if (error) throw error
    if (!data) return json({ error: 'Not found' }, { status: 404 })
    return json({ id: data.id, subscribe: data.subscribe, ai_data: data.ai_data })
  } catch (error) {
    console.error('[Feedback] PATCH error:', error)
    return json({ error: 'Internal server error' }, { status: 500 })
  }
}
