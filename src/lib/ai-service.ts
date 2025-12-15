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

    const prompt = `Analyze this user feedback and classify it. The user is reporting feedback, a bug, feature request, or question.

User message: "${messageRaw}"

Extract:
1. A concise title (5-8 words)
2. A short summary (1-2 sentences)
3. Key details as a list
4. Category: bug, feature, question, billing, praise, or other
5. Feature area: which part of the product (e.g. "export", "upload", "dashboard", "prompts", "billing", "login")
6. Priority: low, medium, or high (high = blocking/urgent, medium = important, low = nice to have)
7. Steps to reproduce (if bug)
8. Expected behavior (if bug)
9. Confidence score (0.0-1.0)
10. Clarifying questions (only if really needed, max 2)

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
