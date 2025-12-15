/**
 * OpenFeedbackLayer API Route Template
 * Copy this file to your Next.js app: app/api/feedback/route.ts
 *
 * Required environment variables:
 * - GEMINI_API_KEY: For AI classification
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: For server-side DB operations
 *
 * Optional:
 * - RESEND_API_KEY: For email notifications
 * - FEEDBACK_NOTIFY_EMAIL: Email to notify on new feedback
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { analyzeFeedback } from 'openfeedbacklayer'

// Initialize Supabase admin client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Rate limiting (in-memory for simplicity)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10
const RATE_WINDOW = 60 * 1000 // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }

  if (entry.count >= RATE_LIMIT) {
    return false
  }

  entry.count++
  return true
}

// Optional: Send notification email
async function sendNotificationEmail(feedback: {
  id: string
  message_raw: string
  page_url: string
  ai_data: { suggested_category?: string; suggested_priority?: string } | null
}) {
  const resendKey = process.env.RESEND_API_KEY
  const notifyEmail = process.env.FEEDBACK_NOTIFY_EMAIL

  if (!resendKey || !notifyEmail) return

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(resendKey)

    const category = feedback.ai_data?.suggested_category || 'unknown'
    const priority = feedback.ai_data?.suggested_priority || 'medium'
    const emoji = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢'

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'feedback@yourdomain.com',
      to: notifyEmail,
      subject: `${emoji} New Feedback: ${category}`,
      html: `
        <h2>New Feedback Received</h2>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Priority:</strong> ${priority}</p>
        <p><strong>Page:</strong> ${feedback.page_url}</p>
        <hr>
        <p><strong>Message:</strong></p>
        <blockquote>${feedback.message_raw.replace(/\n/g, '<br>')}</blockquote>
      `,
    })
  } catch (error) {
    console.error('[Feedback] Failed to send email:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
               request.headers.get('x-real-ip') || 'unknown'

    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const formData = await request.formData()

    // HONEYPOT: If this field has value, it's a bot
    const honeypot = formData.get('website') as string
    if (honeypot && honeypot.trim().length > 0) {
      console.log('[Feedback] Bot detected via honeypot')
      return NextResponse.json({ id: 'fake-id', message: 'Feedback sent' })
    }

    const messageRaw = formData.get('message') as string
    const screenshot = formData.get('screenshot') as File | null
    const projectId = (formData.get('project') as string) || null

    if (!messageRaw?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const pageUrl = request.headers.get('x-page-url') || request.headers.get('referer') || 'unknown'
    const userAgent = request.headers.get('user-agent') || null

    // Handle screenshot upload to Supabase Storage
    let screenshotUrl: string | null = null
    let screenshotBase64: string | null = null

    if (screenshot && screenshot.size > 0) {
      const buffer = Buffer.from(await screenshot.arrayBuffer())
      const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.png`

      const { data: uploadData, error: uploadError } = await supabaseAdmin
        .storage
        .from('feedback')
        .upload(filename, buffer, {
          contentType: 'image/png',
          cacheControl: '3600',
        })

      if (!uploadError && uploadData) {
        const { data: urlData } = supabaseAdmin
          .storage
          .from('feedback')
          .getPublicUrl(filename)
        screenshotUrl = urlData.publicUrl
      }

      screenshotBase64 = `data:image/png;base64,${buffer.toString('base64')}`
    }

    // AI classification
    let aiData = null
    const geminiKey = process.env.GEMINI_API_KEY
    if (geminiKey) {
      aiData = await analyzeFeedback({
        messageRaw,
        screenshotBase64: screenshotBase64 || undefined,
        geminiApiKey: geminiKey,
      })
    }

    // Store feedback
    const { data: feedback, error } = await supabaseAdmin
      .from('feedback')
      .insert({
        page_url: pageUrl,
        user_agent: userAgent,
        message_raw: messageRaw,
        screenshot_url: screenshotUrl,
        ai_data: aiData,
        project_id: projectId,
        status: 'new',
      })
      .select('id')
      .single()

    if (error) {
      console.error('[Feedback] Database error:', error)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    // Send email notification (async)
    sendNotificationEmail({
      id: feedback.id,
      message_raw: messageRaw,
      page_url: pageUrl,
      ai_data: aiData,
    })

    return NextResponse.json({
      id: feedback.id,
      ai_data: aiData,
      message: 'Feedback received',
    })
  } catch (error) {
    console.error('[Feedback] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
