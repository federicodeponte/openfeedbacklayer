import { handleFeedback, realDeps as realFeedbackDeps } from './feedback-core'
import { handleWebhook, realDeps as realWebhookDeps } from './webhook-core'

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
