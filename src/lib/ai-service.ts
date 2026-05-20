/**
 * AI Service for Feedback Classification
 * Uses Gemini 2.5 Flash Lite for fast, cheap classification
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { FeedbackAIData } from './types'

export interface AnalyzeFeedbackParams {
  messageRaw: string
  screenshotBase64?: string
  geminiApiKey: string
}

export interface RefineFeedbackParams {
  messageRaw: string
  /** What the submitter typed in the "this isn't quite right - here's
   *  what I actually meant" follow-up box, after seeing the initial AI
   *  summary. */
  followUp: string
  /** The classification + summary the AI produced on the first pass,
   *  so the model can correct itself rather than re-classify from
   *  scratch. */
  prior: FeedbackAIData
  geminiApiKey: string
}

/**
 * Analyze feedback with Gemini 2.5 Flash Lite
 * Returns structured AI data or null if AI fails (fail gracefully)
 */
export async function analyzeFeedback({
  messageRaw,
  screenshotBase64,
  geminiApiKey,
}: AnalyzeFeedbackParams): Promise<FeedbackAIData | null> {
  if (!geminiApiKey) {
    console.warn('[OpenFeedbackLayer] No Gemini API key provided, skipping AI analysis')
    return null
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })

    const prompt = `Analyze this feedback the submitter just sent in. The
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

    // Build content parts
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt }
    ]

    // Add screenshot if provided (Gemini supports vision)
    if (screenshotBase64) {
      const base64Data = screenshotBase64.includes(',')
        ? screenshotBase64.split(',')[1]
        : screenshotBase64

      let mimeType = 'image/png'
      if (screenshotBase64.startsWith('data:')) {
        const match = screenshotBase64.match(/data:([^;]+)/)
        if (match) {
          mimeType = match[1]
        }
      }

      parts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      })
    }

    const result = await model.generateContent(parts)
    const text = result.response.text()

    if (!text) {
      console.warn('[OpenFeedbackLayer] Empty response from Gemini')
      return null
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = text.trim()
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
    if (jsonMatch) {
      jsonText = jsonMatch[1]
    }

    const aiData = JSON.parse(jsonText) as FeedbackAIData

    // Validate structure
    if (
      !aiData.title ||
      !aiData.short_summary ||
      !Array.isArray(aiData.key_details) ||
      !['bug', 'feature', 'question', 'billing', 'praise', 'other'].includes(aiData.suggested_category) ||
      !aiData.suggested_feature_area ||
      !['low', 'medium', 'high'].includes(aiData.suggested_priority)
    ) {
      console.warn('[OpenFeedbackLayer] Invalid AI response structure', aiData)
      return null
    }

    return aiData
  } catch (error) {
    console.error('[OpenFeedbackLayer] Error analyzing feedback:', error)
    return null // Fail gracefully
  }
}

/**
 * Re-classify feedback after the submitter has read the first pass
 * and typed a follow-up clarification ("you got X wrong, this is
 * actually about Y"). We feed the model the original message, the
 * prior AI output, and the follow-up so it can correct itself instead
 * of re-classifying from scratch and forgetting context.
 *
 * Returns null on any failure so the caller can keep the prior aiData
 * and surface a "couldn't refine, please try again" message.
 */
export async function refineFeedback({
  messageRaw,
  followUp,
  prior,
  geminiApiKey,
}: RefineFeedbackParams): Promise<FeedbackAIData | null> {
  if (!geminiApiKey) {
    console.warn('[OpenFeedbackLayer] No Gemini API key provided, skipping refinement')
    return null
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })

    const prompt = `You previously analyzed a piece of feedback. The submitter
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

    const result = await model.generateContent([{ text: prompt }])
    const text = result.response.text()

    if (!text) {
      console.warn('[OpenFeedbackLayer] Empty response from Gemini refine')
      return null
    }

    let jsonText = text.trim()
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
    if (jsonMatch) {
      jsonText = jsonMatch[1]
    }

    const aiData = JSON.parse(jsonText) as FeedbackAIData

    if (
      !aiData.title ||
      !aiData.short_summary ||
      !Array.isArray(aiData.key_details) ||
      !['bug', 'feature', 'question', 'billing', 'praise', 'other'].includes(aiData.suggested_category) ||
      !aiData.suggested_feature_area ||
      !['low', 'medium', 'high'].includes(aiData.suggested_priority)
    ) {
      console.warn('[OpenFeedbackLayer] Invalid AI refine response structure', aiData)
      return null
    }

    return aiData
  } catch (error) {
    console.error('[OpenFeedbackLayer] Error refining feedback:', error)
    return null
  }
}
