/**
 * Subscriber email helpers for feedback journey updates
 */

import type { JourneyStage } from './types'

const STAGE_SUBJECTS: Record<JourneyStage, (issueNumber: number) => string> = {
  received: (issueNumber) => `We got your feedback (#${issueNumber})`,
  triaged: (issueNumber) => `Your feedback is triaged (#${issueNumber})`,
  in_progress: (issueNumber) => `We're working on your feedback (#${issueNumber})`,
  shipped: (issueNumber) => `Your feedback shipped (#${issueNumber})`,
  wont_fix: (issueNumber) => `An update on your feedback (#${issueNumber})`,
}

const STAGE_COPY: Record<JourneyStage, string> = {
  received: 'We received your feedback and opened an issue so the team can track it.',
  triaged: 'Your feedback has been reviewed and triaged by the team.',
  in_progress: 'The team is actively working on your feedback now.',
  shipped: 'The change connected to your feedback has shipped.',
  wont_fix: 'The team reviewed your feedback and is not planning to make this change.',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendSubscriberEmail(p: {
  resendKey: string
  from: string
  to: string
  subject: string
  paragraph: string
  issueUrl: string
}): Promise<void> {
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(p.resendKey)

    await resend.emails.send({
      from: p.from,
      to: p.to,
      subject: p.subject,
      html: `
        <p>${escapeHtml(p.paragraph)}</p>
        <p><a href="${escapeHtml(p.issueUrl)}">Follow along</a></p>
      `,
    })
  } catch (error) {
    console.error('[OpenFeedbackLayer] Failed to send subscriber email:', error)
  }
}

export async function sendConfirmationEmail(p: {
  resendKey: string
  from: string
  to: string
  issueNumber: number
  issueUrl: string
  title: string
}): Promise<void> {
  await sendSubscriberEmail({
    resendKey: p.resendKey,
    from: p.from,
    to: p.to,
    subject: STAGE_SUBJECTS.received(p.issueNumber),
    paragraph: `We received "${p.title}" and opened an issue so the team can track it.`,
    issueUrl: p.issueUrl,
  })
}

export async function sendStageEmail(p: {
  resendKey: string
  from: string
  to: string
  stage: JourneyStage
  issueNumber: number
  issueUrl: string
  title: string
}): Promise<void> {
  await sendSubscriberEmail({
    resendKey: p.resendKey,
    from: p.from,
    to: p.to,
    subject: STAGE_SUBJECTS[p.stage](p.issueNumber),
    paragraph: `${STAGE_COPY[p.stage]}: "${p.title}".`,
    issueUrl: p.issueUrl,
  })
}
