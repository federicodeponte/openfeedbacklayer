/**
 * OpenFeedbackLayer PATCH /api/feedback/[id] template.
 *
 * Lets the original submitter (within their own success-state session)
 * flip subscribe + correct the AI classification if it got the category /
 * feature area / priority wrong. Trust model: anyone with the UUID can
 * mutate the whitelisted fields. UUIDs are only returned to the submitter
 * (POST /api/feedback response) and never leak to GitHub or the webhook
 * payload. Acceptable for v0; future = short-lived signed edit token.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import type { NextRequest } from 'next/server'
import { feedbackPATCH } from 'openfeedbacklayer/server'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  return feedbackPATCH(request, id)
}
