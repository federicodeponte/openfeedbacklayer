/**
 * AI Service for Feedback Classification
 *
 * Two providers, picked at call time by whichever key is present:
 *   - OpenAI (gpt-4o-mini by default) — preferred when OPENAI_API_KEY is set
 *   - Google Gemini (gemini-2.5-flash-lite) — fallback
 *
 * OpenAI is preferred because the Gemini free tier caps at 20 requests/day,
 * which exhausts fast on any real deployment. Both providers return the same
 * FeedbackAIData JSON shape; the widget/server never has to know which ran.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { FeedbackAIData } from './types'

/** Provider keys — supply either or both; OpenAI wins when both are set. */
export interface AIProviderKeys {
  openaiApiKey?: string
  geminiApiKey?: string
  /** Override the OpenAI model. Default: gpt-4o-mini. */
  openaiModel?: string
}

export interface AnalyzeFeedbackParams extends AIProviderKeys {
  messageRaw: string
  screenshotBase64?: string
}

export interface RefineFeedbackParams extends AIProviderKeys {
  messageRaw: string
  /** What the submitter typed in the "this isn't quite right - here's
   *  what I actually meant" follow-up box, after seeing the initial AI
   *  summary. */
  followUp: string
  /** The classification + summary the AI produced on the first pass,
   *  so the model can correct itself rather than re-classifying from
   *  scratch. */
  prior: FeedbackAIData
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const GEMINI_MODEL = 'gemini-2.5-flash-lite'

const CATEGORIES = ['bug', 'feature', 'question', 'billing', 'praise', 'other'] as const
const PRIORITIES = ['low', 'medium', 'high'] as const

/** Shared structural validation so a malformed model response fails closed. */
function isValidAIData(aiData: unknown): aiData is FeedbackAIData {
  const d = aiData as FeedbackAIData
  return Boolean(
    d &&
      d.title &&
      d.short_summary &&
      Array.isArray(d.key_details) &&
      CATEGORIES.includes(d.suggested_category) &&
      d.suggested_feature_area &&
      PRIORITIES.includes(d.suggested_priority),
  )
}

/** Pull the JSON object out of a model response that may be fenced. */
function parseJsonObject(text: string): unknown {
  let jsonText = text.trim()
  const fenced = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
  if (fenced) jsonText = fenced[1]
  return JSON.parse(jsonText)
}

function normalizeBase64(screenshotBase64: string): { mimeType: string; data: string } {
  const data = screenshotBase64.includes(',')
    ? screenshotBase64.split(',')[1]
    : screenshotBase64
  let mimeType = 'image/png'
  if (screenshotBase64.startsWith('data:')) {
    const match = screenshotBase64.match(/data:([^;]+)/)
    if (match) mimeType = match[1]
  }
  return { mimeType, data }
}

/**
 * Run a single classification prompt through whichever provider is
 * configured. Returns the raw model text, or null on any failure.
 * OpenAI is tried first when its key is present.
 */
async function runModel(
  prompt: string,
  keys: AIProviderKeys,
  screenshotBase64?: string,
): Promise<string | null> {
  if (keys.openaiApiKey) {
    return runOpenAI(prompt, keys.openaiApiKey, keys.openaiModel || DEFAULT_OPENAI_MODEL, screenshotBase64)
  }
  if (keys.geminiApiKey) {
    return runGemini(prompt, keys.geminiApiKey, screenshotBase64)
  }
  console.warn('[OpenFeedbackLayer] No AI provider key (OPENAI_API_KEY / GEMINI_API_KEY); skipping AI')
  return null
}

async function runOpenAI(
  prompt: string,
  apiKey: string,
  model: string,
  screenshotBase64?: string,
): Promise<string | null> {
  // Plain fetch — OpenAI's chat-completions API is a simple REST call,
  // so the package avoids taking the openai SDK as a dependency.
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  if (screenshotBase64) {
    const { mimeType, data } = normalizeBase64(screenshotBase64)
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${data}` },
    })
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      // json_object mode guarantees a parseable object back (the prompt
      // already instructs "Return ONLY valid JSON").
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[OpenFeedbackLayer] OpenAI HTTP ${res.status}: ${body.slice(0, 300)}`)
    return null
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return json.choices?.[0]?.message?.content || null
}

async function runGemini(
  prompt: string,
  apiKey: string,
  screenshotBase64?: string,
): Promise<string | null> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
  ]
  if (screenshotBase64) {
    const { mimeType, data } = normalizeBase64(screenshotBase64)
    parts.push({ inlineData: { mimeType, data } })
  }

  const result = await model.generateContent(parts)
  return result.response.text() || null
}

const ANALYZE_PROMPT = (messageRaw: string) => `Analyze this feedback the submitter just sent in. The
short_summary you produce is shown back TO the submitter in the success
state, so write it in SECOND PERSON, addressing them directly. Never refer
to them as "the user" or in third person. Examples:
  GOOD: "You're reporting that the export button does nothing on the dashboard."
  GOOD: "Thanks — you'd like a dark-mode toggle in settings."
  BAD: "The user is reporting an Auto-update failed error."
  BAD: "The user wants a dark mode."

Their message: "${messageRaw}"

Extract:
1. A concise title (5-8 words) — neutral phrasing, not second-person, used for the issue title.
2. short_summary (1-2 sentences) — SECOND PERSON addressing the submitter, as above.
3. Key details as a list (neutral phrasing).
4. Category: bug, feature, question, billing, praise, or other.
5. Feature area: which part of the product (e.g. "export", "upload", "dashboard", "prompts", "billing", "login").
6. Priority: low, medium, or high (high = blocking/urgent, medium = important, low = nice to have).
7. Steps to reproduce (if bug).
8. Expected behavior (if bug).
9. Confidence score (0.0-1.0).
10. Clarifying questions (only if really needed, max 2) — addressed to the submitter in second person.

Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "...",
  "short_summary": "...",
  "key_details": ["...", "..."],
  "suggested_category": "bug"|"feature"|"question"|"billing"|"praise"|"other",
  "suggested_feature_area": "...",
  "suggested_priority": "low"|"medium"|"high",
  "steps": ["...", "..."],
  "expected": "..." or null,
  "confidence": 0.0-1.0,
  "clarifying_questions": ["...", "..."]
}`

const REFINE_PROMPT = (messageRaw: string, prior: FeedbackAIData, followUp: string) => `You previously analyzed a piece of feedback. The submitter
has now sent a follow-up clarification because something in your analysis was
off (wrong category, wrong priority, you missed the actual issue, or the
summary didn't capture it). Use the follow-up to CORRECT your earlier
analysis. Keep what's still right; revise what's now wrong.

short_summary is shown back TO the submitter, so write it in SECOND PERSON
addressing them directly (never "the user" / third person).

Original feedback (do not invent details not present in the original or
the follow-up):
"${messageRaw}"

Your prior analysis:
${JSON.stringify(prior, null, 2)}

Submitter's follow-up clarification:
"${followUp}"

Return ONLY valid JSON (no markdown, no explanation) with the same shape
as before. Revise every field as needed in light of the follow-up:
{
  "title": "...",
  "short_summary": "...",
  "key_details": ["...", "..."],
  "suggested_category": "bug"|"feature"|"question"|"billing"|"praise"|"other",
  "suggested_feature_area": "...",
  "suggested_priority": "low"|"medium"|"high",
  "steps": ["...", "..."],
  "expected": "..." or null,
  "confidence": 0.0-1.0,
  "clarifying_questions": ["...", "..."]
}`

/**
 * Analyze feedback. Returns structured AI data or null if AI fails
 * (fail gracefully — the feedback row is still saved without ai_data).
 */
export async function analyzeFeedback(params: AnalyzeFeedbackParams): Promise<FeedbackAIData | null> {
  try {
    const text = await runModel(ANALYZE_PROMPT(params.messageRaw), params, params.screenshotBase64)
    if (!text) return null
    const aiData = parseJsonObject(text)
    if (!isValidAIData(aiData)) {
      console.warn('[OpenFeedbackLayer] Invalid AI response structure', aiData)
      return null
    }
    return aiData
  } catch (error) {
    console.error('[OpenFeedbackLayer] Error analyzing feedback:', error)
    return null
  }
}

/**
 * Re-classify feedback after the submitter has read the first pass
 * and typed a follow-up clarification ("you got X wrong, this is
 * actually about Y"). Feeds the model the original message, the prior
 * AI output, and the follow-up so it corrects itself rather than
 * re-classifying from scratch.
 *
 * Returns null on any failure so the caller can keep the prior aiData
 * and surface a graceful message.
 */
export async function refineFeedback(params: RefineFeedbackParams): Promise<FeedbackAIData | null> {
  try {
    const text = await runModel(
      REFINE_PROMPT(params.messageRaw, params.prior, params.followUp),
      params,
    )
    if (!text) return null
    const aiData = parseJsonObject(text)
    if (!isValidAIData(aiData)) {
      console.warn('[OpenFeedbackLayer] Invalid AI refine response structure', aiData)
      return null
    }
    return aiData
  } catch (error) {
    console.error('[OpenFeedbackLayer] Error refining feedback:', error)
    return null
  }
}
