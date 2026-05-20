import type { NextRequest } from 'next/server'
import { feedbackPATCH } from 'openfeedbacklayer/server'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  return feedbackPATCH(request, id)
}
