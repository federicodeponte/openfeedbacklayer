import { handleFeedback, realDeps as realFeedbackDeps } from './feedback-core'
import { handleWebhook, realDeps as realWebhookDeps } from './webhook-core'
import { handlePatch, realPatchDeps } from './feedback-patch-core'

export { handlePatch, realPatchDeps, type PatchFeedbackDeps } from './feedback-patch-core'

export {
  handleFeedback,
  realDeps as realFeedbackDeps,
  type FeedbackDeps,
  type ServerEnv,
} from './feedback-core'
export {
  handleWebhook,
  realDeps as realWebhookDeps,
  type WebhookDeps,
} from './webhook-core'

// Thin Next.js Route Handler adapters so host apps can install with one
// line per route instead of copy-pasting templates:
//   // app/api/feedback/route.ts
//   export { feedbackPOST as POST } from 'openfeedbacklayer/server'
//   // app/api/feedback/webhook/route.ts
//   export { webhookPOST as POST } from 'openfeedbacklayer/server'
// realFeedbackDeps / realWebhookDeps read env vars at request time.
export const feedbackPOST = (request: Request): Promise<Response> =>
  handleFeedback(request, realFeedbackDeps(process.env))
export const webhookPOST = (request: Request): Promise<Response> =>
  handleWebhook(request, realWebhookDeps(process.env))
// PATCH /api/feedback/[id] — let the original submitter (within their
// success-state session) flip subscribe and correct the AI classification
// if it got category / feature_area / priority wrong. Mount at the dynamic
// id route, e.g.:
//   // app/api/feedback/[id]/route.ts
//   import { feedbackPATCH } from 'openfeedbacklayer/server'
//   export const PATCH = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
//     ctx.params.then(({ id }) => feedbackPATCH(req, id))
export const feedbackPATCH = (request: Request, id: string): Promise<Response> =>
  handlePatch(request, id, realPatchDeps(process.env))

/**
 * GET /api/feedback/health — cheap liveness/readiness probe for
 * load balancers, uptime monitors, and CI smoke tests. Reports which
 * optional integrations are configured (no secrets leaked, just
 * presence/absence). Returns 200 unconditionally so a degraded but
 * running deploy still answers OK.
 *
 *   // app/api/feedback/health/route.ts
 *   export { feedbackHealthGET as GET } from 'openfeedbacklayer/server'
 */
export const feedbackHealthGET = (_request: Request): Response => {
  const env = process.env
  const openai = Boolean(env.OPENAI_API_KEY)
  const gemini = Boolean(env.GEMINI_API_KEY)
  return Response.json({
    status: 'ok',
    integrations: {
      supabase: Boolean(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL),
      // AI provider: openai is preferred when both keys are set (Gemini
      // free tier caps at 20 req/day). `ai` is true if EITHER is set so
      // health monitors can branch on a single field.
      ai: openai || gemini,
      openai,
      gemini,
      github: Boolean(env.GITHUB_TOKEN && env.GITHUB_FEEDBACK_REPO),
      resend: Boolean(env.RESEND_API_KEY),
      webhook_secret: Boolean(env.GITHUB_WEBHOOK_SECRET),
    },
    timestamp: new Date().toISOString(),
  })
}
export {
  buildFeedbackIssuePayload,
  createFeedbackIssue,
  stageFromGitHubEvent,
  verifyGitHubSignature,
} from '../lib/github-service'
export {
  sendConfirmationEmail,
  sendStageEmail,
} from '../lib/subscriber-email'
