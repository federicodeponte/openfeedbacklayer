import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerEnv } from './feedback-core'

/**
 * PATCH /api/feedback/[id] — let the original submitter (within their own
 * success-state session) change subscribe + correct the AI classification
 * if it got the category / feature area / priority wrong.
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
 *   - suggested_category: bug | feature | question | billing | praise | other
 *   - suggested_feature_area: string (1-64 chars)
 *   - suggested_priority: low | medium | high
 */

export interface PatchFeedbackDeps {
  supabase: SupabaseClient
  env: ServerEnv
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORIES = ['bug', 'feature', 'question', 'billing', 'praise', 'other'] as const
const PRIORITIES = ['low', 'medium', 'high'] as const

let supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin(env: ServerEnv) {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
  }
  return supabaseAdmin
}

export function realPatchDeps(env: ServerEnv = process.env): PatchFeedbackDeps {
  return { supabase: getSupabaseAdmin(env), env }
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
  const aiPatch: Record<string, string> = {}

  if (body.subscribe !== undefined) {
    if (typeof body.subscribe !== 'boolean') {
      return json({ error: 'subscribe must be boolean' }, { status: 400 })
    }
    updates.subscribe = body.subscribe
  }

  if (body.suggested_category !== undefined) {
    if (typeof body.suggested_category !== 'string' || !CATEGORIES.includes(body.suggested_category as typeof CATEGORIES[number])) {
      return json({ error: 'invalid suggested_category' }, { status: 400 })
    }
    aiPatch.suggested_category = body.suggested_category
  }

  if (body.suggested_priority !== undefined) {
    if (typeof body.suggested_priority !== 'string' || !PRIORITIES.includes(body.suggested_priority as typeof PRIORITIES[number])) {
      return json({ error: 'invalid suggested_priority' }, { status: 400 })
    }
    aiPatch.suggested_priority = body.suggested_priority
  }

  if (body.suggested_feature_area !== undefined) {
    if (
      typeof body.suggested_feature_area !== 'string' ||
      body.suggested_feature_area.length < 1 ||
      body.suggested_feature_area.length > 64
    ) {
      return json({ error: 'invalid suggested_feature_area' }, { status: 400 })
    }
    aiPatch.suggested_feature_area = body.suggested_feature_area.trim()
  }

  if (Object.keys(updates).length === 0 && Object.keys(aiPatch).length === 0) {
    return json({ error: 'No mutable fields supplied' }, { status: 400 })
  }

  try {
    // For ai_data, fetch-merge-write so we preserve untouched fields.
    if (Object.keys(aiPatch).length > 0) {
      const { data: existing, error: readErr } = await deps.supabase
        .from('feedback')
        .select('ai_data')
        .eq('id', id)
        .maybeSingle()
      if (readErr) throw readErr
      if (!existing) return json({ error: 'Not found' }, { status: 404 })
      const merged = { ...((existing.ai_data as Record<string, unknown>) || {}), ...aiPatch }
      updates.ai_data = merged
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
