'use client'

/**
 * OpenFeedbackLayer Widget
 * A floating feedback button with AI classification
 */

import React, { useState, useRef, useEffect, useId } from 'react'
import type { FeedbackWidgetProps } from '../lib/types'

/**
 * Subset of FeedbackAIData the success-state UI consumes. Re-declared
 * structurally (not imported) so the widget bundle stays decoupled from
 * the server-side types file — keeps the client tree-shake clean.
 */
interface FeedbackAIDataLike {
  title?: string
  short_summary?: string
  suggested_category?: string
  suggested_feature_area?: string
  suggested_priority?: string
}

const DEFAULT_COLORS = {
  primary: '#2563eb', // blue-600
  primaryHover: '#1d4ed8', // blue-700
  success: '#16a34a', // green-600
  text: '#1f2937', // gray-800
  textMuted: '#6b7280', // gray-500
  bg: '#ffffff',
  border: '#e5e7eb', // gray-200
}

const STYLES = {
  container: {
    position: 'fixed',
    zIndex: 99999,
    // Inter first (Floom design system), system-ui as graceful fallback for
    // consumers that don't load Inter. Children inherit via fontFamily: inherit.
    fontFamily: '"Inter", "Inter Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    width: 48,
    height: 48,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    backgroundColor: 'var(--ofl-primary)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  popup: {
    position: 'absolute',
    width: 320,
    // iPhone SE (320px viewport) was previously flush to the edge / overflowing.
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: '75vh',
    backgroundColor: DEFAULT_COLORS.bg,
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '12px 16px',
    borderBottom: `1px solid ${DEFAULT_COLORS.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: DEFAULT_COLORS.text,
    margin: 0,
  },
  closeButton: {
    fontFamily: 'inherit',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    width: 44,
    height: 44,
    padding: 10,
    color: DEFAULT_COLORS.textMuted,
    fontSize: 18,
    lineHeight: 1,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  body: {
    padding: 16,
    overflowY: 'auto',
    flex: 1,
  },
  textarea: {
    width: '100%',
    minHeight: 100,
    padding: 12,
    border: `1px solid ${DEFAULT_COLORS.border}`,
    borderRadius: 8,
    fontSize: 14,
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  emailInput: {
    width: '100%',
    height: 40,
    padding: '8px 12px',
    border: `1px solid ${DEFAULT_COLORS.border}`,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    marginTop: 8,
  },
  subscribeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    color: DEFAULT_COLORS.textMuted,
    fontSize: 12,
  },
  subscribeLabel: {
    color: DEFAULT_COLORS.textMuted,
    fontSize: 12,
    cursor: 'pointer',
  },
  checkbox: {
    fontFamily: 'inherit',
    width: 14,
    height: 14,
    margin: 0,
  },
  screenshotPreview: {
    marginTop: 8,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    maxHeight: 120,
    objectFit: 'cover',
    borderRadius: 8,
    border: `1px solid ${DEFAULT_COLORS.border}`,
  },
  removeButton: {
    fontFamily: 'inherit',
    position: 'absolute',
    top: 4,
    right: 4,
    width: 44,
    height: 44,
    borderRadius: '50%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    fontFamily: 'inherit',
    flex: 1,
    padding: '10px 16px',
    minHeight: 44,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  },
  primaryButton: {
    backgroundColor: 'var(--ofl-primary)',
    color: 'white',
  },
  secondaryButton: {
    backgroundColor: DEFAULT_COLORS.border,
    color: DEFAULT_COLORS.text,
  },
  badge: {
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
    marginRight: 6,
    marginBottom: 6,
  },
  aiTitle: {
    // Headline of the success state — the AI's understood title of the
    // issue, in the submitter's voice. Bold so it reads as "we got it",
    // sized between the popup title and body copy.
    fontSize: 16,
    fontWeight: 600,
    color: DEFAULT_COLORS.text,
    margin: '0 0 8px',
    lineHeight: 1.35,
  },
  successMessage: {
    textAlign: 'center',
    padding: 20,
  },
  checkmark: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    backgroundColor: DEFAULT_COLORS.success,
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    margin: '0 auto 16px',
  },
  errorMark: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    backgroundColor: '#dc2626',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    margin: '0 auto 16px',
  },
  hint: {
    fontSize: 12,
    color: DEFAULT_COLORS.textMuted,
    marginTop: 8,
  },
  feedbackText: {
    fontSize: 14,
    color: DEFAULT_COLORS.text,
    marginBottom: 12,
  },
  subscribeAfterLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    fontSize: 12,
    color: DEFAULT_COLORS.textMuted,
    marginBottom: 12,
    cursor: 'pointer',
  },
  subscribeAfterEmail: {
    wordBreak: 'break-all',
  },
  addEmailForm: {
    marginTop: 4,
    marginBottom: 12,
  },
  addEmailLabel: {
    display: 'block',
    fontSize: 12,
    color: DEFAULT_COLORS.textMuted,
    marginBottom: 6,
  },
  addEmailRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'stretch',
  },
  addEmailInput: {
    fontFamily: 'inherit',
    fontSize: 13,
    padding: '8px 10px',
    flex: 1,
    minWidth: 0,
    border: `1px solid ${DEFAULT_COLORS.border}`,
    borderRadius: 8,
    backgroundColor: DEFAULT_COLORS.bg,
    color: DEFAULT_COLORS.text,
  },
  addEmailSubmit: {
    flex: 0,
    minHeight: 0,
    padding: '8px 14px',
  },
  badgeRow: {
    marginBottom: 4,
  },
  categoryBadge: {
    backgroundColor: '#dbeafe',
    color: '#1e40af',
  },
  featureAreaBadge: {
    backgroundColor: '#f3e8ff',
    color: '#7c3aed',
  },
  priorityHighBadge: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
  },
  priorityMediumBadge: {
    backgroundColor: '#fef3c7',
    color: '#d97706',
  },
  priorityLowBadge: {
    backgroundColor: '#dcfce7',
    color: '#16a34a',
  },
  refineToggle: {
    // Lightweight link-style button under the badges. Says "Not quite right?
    // Add more details" — when clicked, expands the refine textarea.
    background: 'transparent',
    border: 'none',
    color: DEFAULT_COLORS.primary,
    fontFamily: 'inherit',
    fontSize: 12,
    padding: '4px 8px',
    margin: '4px 0 8px',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  refineForm: {
    marginTop: 4,
    marginBottom: 12,
    textAlign: 'left',
  },
  refineLabel: {
    display: 'block',
    fontSize: 12,
    color: DEFAULT_COLORS.textMuted,
    marginBottom: 6,
  },
  refineTextarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 60,
    padding: '8px 10px',
    border: `1px solid ${DEFAULT_COLORS.border}`,
    borderRadius: 8,
    backgroundColor: DEFAULT_COLORS.bg,
    color: DEFAULT_COLORS.text,
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    resize: 'vertical',
  },
  refineError: {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 6,
    marginBottom: 0,
  },
  refineActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  refineCancel: {
    flex: 0,
    minHeight: 0,
    padding: '6px 12px',
    fontSize: 13,
  },
  refineSubmit: {
    flex: 0,
    minHeight: 0,
    padding: '6px 14px',
    fontSize: 13,
  },
  closeActionButton: {
    marginTop: 16,
  },
  honeypot: {
    position: 'absolute',
    left: '-9999px',
    opacity: 0,
    height: 0,
    width: 0,
    pointerEvents: 'none',
  },
  fileInput: {
    display: 'none',
  },
  screenshotButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  disabledButton: {
    opacity: 0.6,
  },
} satisfies Record<string, React.CSSProperties>

type StyleName = keyof typeof STYLES

const POSITION_CLASS_BY_POSITION = {
  'bottom-right': 'pos-br',
  'bottom-left': 'pos-bl',
  'top-right': 'pos-tr',
  'top-left': 'pos-tl',
} as const satisfies Record<NonNullable<FeedbackWidgetProps['position']>, string>

const POPUP_POSITION_CLASS_BY_POSITION = {
  'bottom-right': 'popup-pos-br',
  'bottom-left': 'popup-pos-bl',
  'top-right': 'popup-pos-tr',
  'top-left': 'popup-pos-tl',
} as const satisfies Record<NonNullable<FeedbackWidgetProps['position']>, string>

const POSITION_STYLES = {
  'pos-br': { bottom: 20, right: 20 },
  'pos-bl': { bottom: 20, left: 20 },
  'pos-tr': { top: 20, right: 20 },
  'pos-tl': { top: 20, left: 20 },
  'popup-pos-br': { bottom: 0, right: 0 },
  'popup-pos-bl': { bottom: 0, left: 0 },
  'popup-pos-tr': { top: 0, right: 0 },
  'popup-pos-tl': { top: 0, left: 0 },
} satisfies Record<string, React.CSSProperties>

const CSS_UNITLESS_PROPERTIES = new Set([
  'opacity',
  'zIndex',
  'fontWeight',
  'lineHeight',
  'flex',
  'flexGrow',
  'flexShrink',
  'order',
])

function toKebabCase(property: string) {
  return property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

function toCssValue(property: string, value: string | number) {
  if (typeof value === 'number' && value !== 0 && !CSS_UNITLESS_PROPERTIES.has(property)) {
    return `${value}px`
  }

  return String(value)
}

function styleToDeclarations(style: React.CSSProperties) {
  return Object.entries(style)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
    .map(([property, value]) => `${toKebabCase(property)}: ${toCssValue(property, value)};`)
    .join(' ')
}

function sanitizeCssCustomPropertyValue(value: string) {
  if (/[;{}<>]|\/\*|\*\//.test(value)) {
    return DEFAULT_COLORS.primary
  }

  return value
}

function buildScopedCss(instanceId: string, primaryColor: string) {
  const scope = `ofl-${instanceId}`
  const rules = Object.entries(STYLES).map(([name, style]) => {
    const declarations = styleToDeclarations(style)
    const customProperty = name === 'container'
      ? ` --ofl-primary: ${sanitizeCssCustomPropertyValue(primaryColor)};`
      : ''

    return `.${scope}-${name} { ${declarations}${customProperty} }`
  })

  for (const [name, style] of Object.entries(POSITION_STYLES)) {
    rules.push(`.${scope}-${name} { ${styleToDeclarations(style)} }`)
  }

  return rules.join('\n')
}

export function FeedbackWidget({
  apiEndpoint = '/api/feedback',
  projectId,
  position = 'bottom-right',
  primaryColor = DEFAULT_COLORS.primary,
  nonce,
  buttonText = 'Feedback',
  placeholder = 'Describe your feedback, bug, or feature request...',
  collectEmail = true,
  emailPlaceholder = 'Your email (optional, to hear back)',
  onSubmit,
  onError,
}: FeedbackWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [email, setEmail] = useState('')
  const [subscribe, setSubscribe] = useState(false)
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [classification, setClassification] = useState<{
    category: string
    feature_area: string
    priority: string
  } | null>(null)
  const [honeypot, setHoneypot] = useState('')
  // Post-submit edit state. feedbackId is returned by POST and used by PATCH
  // for the follow-up refine flow + subscribe toggle.
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  // The AI's understood title is the headline of the success state - the
  // submitter wants to know "did the AI actually understand my issue?", not
  // just "was it categorised". Persisted so a refine round-trip can update it.
  const [aiTitle, setAiTitle] = useState<string | null>(null)
  const [patching, setPatching] = useState(false)
  // Lets a submitter who skipped the email field still subscribe to updates
  // after seeing the success state (PR review feedback).
  const [postSubmitEmailDraft, setPostSubmitEmailDraft] = useState('')
  // Refine flow: submitter reads the AI's summary, decides the AI missed or
  // mis-classified something, opens the refine textarea, types a clarification,
  // PATCH ships it to the server which re-runs Gemini.
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineDraft, setRefineDraft] = useState('')
  const [refineError, setRefineError] = useState<string | null>(null)


  const reactId = useId()
  const instanceId = reactId.replace(/:/g, '')
  const popupId = `ofl-popup-${instanceId}`
  const titleId = `ofl-title-${instanceId}`
  const descriptionId = `ofl-description-${instanceId}`
  const messageId = `ofl-msg-${instanceId}`
  const emailId = `ofl-email-${instanceId}`
  const subscribeId = `ofl-subscribe-${instanceId}`

  const fabRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const cssText = buildScopedCss(instanceId, primaryColor)
  const cls = (...names: Array<StyleName | string | false | null | undefined>) =>
    names.filter(Boolean).map((name) => `ofl-${instanceId}-${name}`).join(' ')

  // Reset state when closing
  const handleClose = () => {
    const wasSent = isSent
    const hadError = Boolean(error)

    setIsOpen(false)
    window.setTimeout(() => {
      fabRef.current?.focus()
    }, 0)

    if (wasSent) {
      // Reset after closing sent state
      setTimeout(() => {
        setMessage('')
        setScreenshotFile(null)
        setScreenshotPreview(null)
        setEmail('')
        setSubscribe(false)
        setIsSent(false)
        setError(null)
        setAiResponse(null)
        setClassification(null)
        setFeedbackId(null)
        setAiTitle(null)
        setRefineOpen(false)
        setRefineDraft('')
        setRefineError(null)
      }, 300)
    } else if (hadError) {
      setTimeout(() => {
        setError(null)
      }, 300)
    }
  }

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = Array.from(
        popupRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((element) =>
        !element.hasAttribute('disabled') &&
        element.tabIndex !== -1 &&
        element.getClientRects().length > 0
      )

      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSent, error])

  // Handle paste for screenshots
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!isOpen) return
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            handleScreenshotSelect(file)
          }
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [isOpen])

  // Handle screenshot selection
  const handleScreenshotSelect = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB')
      return
    }
    setScreenshotFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setScreenshotPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  // Handle drag & drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) {
      handleScreenshotSelect(file)
    }
  }

  // Format priority for display
  const formatPriority = (priority: string) => {
    const map: Record<string, string> = { high: 'P0', medium: 'P1', low: 'P2' }
    return map[priority] || 'P1'
  }

  // Send feedback
  const handleSend = async () => {
    if (!message.trim() || isSending) return

    setIsSending(true)
    setError(null)
    const trimmedEmail = email.trim()

    try {
      const formData = new FormData()
      formData.append('message', message)
      formData.append('website', honeypot) // Honeypot field
      formData.append('subscribe', subscribe && trimmedEmail ? 'true' : 'false')

      if (trimmedEmail) {
        formData.append('email', trimmedEmail)
      }

      if (projectId) {
        formData.append('project', projectId)
      }

      if (screenshotFile) {
        formData.append('screenshot', screenshotFile)
      }

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'x-page-url': typeof window !== 'undefined' ? window.location.href : '',
        },
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Failed to send feedback')
      }

      const result = await response.json()
      const aiData = result.ai_data
      setFeedbackId(result.id || null)

      if (aiData) {
        setClassification({
          category: aiData.suggested_category || 'other',
          feature_area: aiData.suggested_feature_area || 'general',
          priority: formatPriority(aiData.suggested_priority || 'medium'),
        })
        setAiTitle(aiData.title || null)
        setAiResponse(aiData.short_summary || 'Thanks - your feedback is in.')
      } else {
        setClassification({
          category: 'feedback',
          feature_area: 'general',
          priority: 'P1',
        })
        setAiTitle(null)
        setAiResponse('Thanks - your feedback is in.')
      }

      setIsSent(true)

      // Callback
      if (onSubmit) {
        onSubmit({
          message_raw: message,
          page_url: typeof window !== 'undefined' ? window.location.href : '',
          ai_data: aiData,
          submitter_email: trimmedEmail || null,
          subscribe: Boolean(subscribe && trimmedEmail),
        })
      }
    } catch (error) {
      console.error('[OpenFeedbackLayer] Send error:', error)
      setError("We couldn't send your feedback right now.")
      setIsSent(false)

      if (onError && error instanceof Error) {
        onError(error)
      }
    } finally {
      setIsSending(false)
    }
  }

  // PATCH the feedback row after submit. Used by the success-state edit UI
  // (subscribe toggle + correct AI classification badges). The server side
  // whitelists fields and validates each one (see feedback-patch-core.ts).
  const sendPatch = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!feedbackId) return false
    setPatching(true)
    try {
      const res = await fetch(`${apiEndpoint}/${feedbackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return false
      return true
    } catch {
      return false
    } finally {
      setPatching(false)
    }
  }

  const handleToggleSubscribeAfterSend = async (next: boolean) => {
    const prev = subscribe
    setSubscribe(next) // optimistic
    const ok = await sendPatch({ subscribe: next })
    if (!ok) setSubscribe(prev)
  }

  const handleAddEmailAfterSubmit = async (newEmail: string) => {
    const prevEmail = email
    const prevSubscribe = subscribe
    setEmail(newEmail)       // optimistic local
    setSubscribe(true)
    const ok = await sendPatch({ submitter_email: newEmail, subscribe: true })
    if (!ok) {
      setEmail(prevEmail)
      setSubscribe(prevSubscribe)
    } else {
      setPostSubmitEmailDraft('')
    }
  }

  // Refine flow: submitter saw the AI's summary, decided it missed or
  // mis-classified something, typed a clarification, hit "Update". We send
  // the follow-up to the server which re-runs Gemini on
  // (original message + prior aiData + this follow-up) and returns the
  // corrected ai_data. The UI then re-renders title + summary + chips.
  const handleSubmitRefine = async () => {
    const followUp = refineDraft.trim()
    if (!followUp || !feedbackId || patching) return

    setRefineError(null)
    setPatching(true)
    try {
      const res = await fetch(`${apiEndpoint}/${feedbackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up: followUp }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setRefineError(body?.error || "We couldn't refine that - please try again.")
        return
      }

      const data = (await res.json()) as { ai_data?: FeedbackAIDataLike | null }
      const refined = data.ai_data
      if (refined) {
        setAiTitle(refined.title || null)
        setAiResponse(refined.short_summary || aiResponse)
        setClassification({
          category: refined.suggested_category || 'other',
          feature_area: refined.suggested_feature_area || 'general',
          priority: formatPriority(refined.suggested_priority || 'medium'),
        })
      }
      setRefineDraft('')
      setRefineOpen(false)
    } catch (err) {
      console.error('[OpenFeedbackLayer] Refine error:', err)
      setRefineError("We couldn't refine that - please try again.")
    } finally {
      setPatching(false)
    }
  }

  return (
    <div className={cls('container', POSITION_CLASS_BY_POSITION[position])}>
      <style nonce={nonce}>{cssText}</style>
      <button
        ref={fabRef}
        className={cls('button')}
        onClick={() => setIsOpen(true)}
        title={buttonText}
        aria-label={buttonText}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={popupId}
        tabIndex={isOpen ? -1 : 0}
      >
        {/* lucide MessageSquareText - uniform stroke-1.75 per Floom UI bar */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M7 9h10" />
          <path d="M7 13h6" />
        </svg>
      </button>

      {isOpen && (
        // Open state - popup
        <div
          ref={popupRef}
          id={popupId}
          className={cls('popup', POPUP_POSITION_CLASS_BY_POSITION[position])}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <div className={cls('header')}>
            <h3 id={titleId} className={cls('title')}>Send feedback</h3>
            <button className={cls('closeButton')} onClick={handleClose} aria-label="Close feedback">
              ×
            </button>
          </div>

          <div className={cls('body')}>
            <p id={descriptionId} className={cls('srOnly')}>
              Send a feedback message with an optional screenshot and email address.
            </p>

            {error ? (
              <div className={cls('successMessage')} role="alert" aria-live="assertive">
                <div className={cls('errorMark')}>✕</div>
                <p className={cls('feedbackText')}>
                  {error}
                </p>
                <div className={cls('actions')}>
                  <button
                    className={cls('actionButton', 'primaryButton')}
                    onClick={handleSend}
                    disabled={isSending}
                  >
                    {isSending ? 'Sending...' : 'Retry'}
                  </button>
                  <button
                    className={cls('actionButton', 'secondaryButton')}
                    onClick={handleClose}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : isSent ? (
              // Success state. The headline is the AI's understood title of
              // the issue (what's actually wrong, in 5-8 words) — that's the
              // signal the submitter wants ("did the AI get it right?"). The
              // short_summary lives under it as the friendly "we got it"
              // acknowledgement. If the AI got something wrong, the submitter
              // opens the refine box below and sends a follow-up clarification
              // that re-runs Gemini server-side.
              <div className={cls('successMessage')} role="status" aria-live="polite">
                <div className={cls('checkmark')}>✓</div>
                {aiTitle && (
                  <p className={cls('aiTitle')}>
                    {aiTitle}
                  </p>
                )}
                {aiResponse && (
                  <p className={cls('feedbackText')}>
                    {aiResponse}
                  </p>
                )}

                {/* Post-submit subscribe section. If an email was entered at
                    submit time, show a toggle so the submitter can flip
                    subscribe. If no email was entered, show an "Add email to
                    get updates" input so they can still subscribe after the
                    fact (Federico's review feedback). */}
                {feedbackId && email.trim() && (
                  <label
                    htmlFor={`${subscribeId}-after`}
                    className={cls('subscribeAfterLabel')}
                  >
                    <input
                      id={`${subscribeId}-after`}
                      type="checkbox"
                      checked={subscribe}
                      disabled={patching}
                      onChange={(e) => handleToggleSubscribeAfterSend(e.target.checked)}
                      className={cls('checkbox')}
                    />
                    {subscribe ? (
                      <span>
                        We'll email <span className={cls('subscribeAfterEmail')}>{email.trim()}</span> with updates
                      </span>
                    ) : (
                      <span>Email me when this is addressed</span>
                    )}
                  </label>
                )}

                {feedbackId && !email.trim() && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const value = postSubmitEmailDraft.trim()
                      if (!value) return
                      handleAddEmailAfterSubmit(value)
                    }}
                    className={cls('addEmailForm')}
                    aria-label="Add your email to get updates"
                  >
                    <label htmlFor={`${emailId}-after`} className={cls('addEmailLabel')}>
                      Want updates as this is addressed?
                    </label>
                    <div className={cls('addEmailRow')}>
                      <input
                        id={`${emailId}-after`}
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={postSubmitEmailDraft}
                        onChange={(e) => setPostSubmitEmailDraft(e.target.value)}
                        disabled={patching}
                        className={cls('addEmailInput')}
                      />
                      <button
                        type="submit"
                        disabled={patching || !postSubmitEmailDraft.trim()}
                        className={cls('actionButton', 'primaryButton', 'addEmailSubmit')}
                      >
                        {patching ? 'Saving...' : 'Subscribe'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Read-only classification chips. They're just visual
                    confirmation of how the AI bucketed the issue; correcting
                    them happens through the refine textarea below (Federico's
                    UX feedback: click-to-edit badges felt fiddly and didn't
                    let him fix the summary itself). */}
                {classification && (
                  <div className={cls('badgeRow')} aria-label="AI classification">
                    <span className={cls('badge', 'categoryBadge')}>
                      {classification.category}
                    </span>
                    <span className={cls('badge', 'featureAreaBadge')}>
                      {classification.feature_area}
                    </span>
                    <span
                      className={cls(
                        'badge',
                        classification.priority === 'P0' && 'priorityHighBadge',
                        classification.priority === 'P1' && 'priorityMediumBadge',
                        classification.priority !== 'P0' && classification.priority !== 'P1' && 'priorityLowBadge',
                      )}
                    >
                      {classification.priority}
                    </span>
                  </div>
                )}

                {/* Refine flow: lets the submitter clarify ("you misread it
                    as a bug - it's actually a feature request") and have the
                    AI re-summarise + re-classify both. Server PATCHes
                    {follow_up} -> re-runs Gemini -> returns refined ai_data. */}
                {feedbackId && !refineOpen && (
                  <button
                    type="button"
                    className={cls('refineToggle')}
                    onClick={() => {
                      setRefineOpen(true)
                      setRefineError(null)
                    }}
                  >
                    Not quite right? Add more details
                  </button>
                )}

                {feedbackId && refineOpen && (
                  <form
                    className={cls('refineForm')}
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleSubmitRefine()
                    }}
                  >
                    <label htmlFor={`${messageId}-refine`} className={cls('refineLabel')}>
                      What did we miss? We'll update the summary.
                    </label>
                    <textarea
                      id={`${messageId}-refine`}
                      className={cls('refineTextarea')}
                      placeholder="e.g. 'It's not a bug, it's a feature request — I want a dark-mode toggle in settings.'"
                      value={refineDraft}
                      onChange={(e) => setRefineDraft(e.target.value)}
                      disabled={patching}
                      rows={3}
                      maxLength={2000}
                      autoFocus
                    />
                    {refineError && (
                      <p className={cls('refineError')} role="alert">
                        {refineError}
                      </p>
                    )}
                    <div className={cls('refineActions')}>
                      <button
                        type="button"
                        className={cls('actionButton', 'secondaryButton', 'refineCancel')}
                        onClick={() => {
                          setRefineOpen(false)
                          setRefineDraft('')
                          setRefineError(null)
                        }}
                        disabled={patching}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className={cls('actionButton', 'primaryButton', 'refineSubmit')}
                        disabled={patching || !refineDraft.trim()}
                      >
                        {patching ? 'Updating...' : 'Update summary'}
                      </button>
                    </div>
                  </form>
                )}

                <button
                  className={cls('actionButton', 'secondaryButton', 'closeActionButton')}
                  onClick={handleClose}
                >
                  Close
                </button>
              </div>
            ) : (
              // Input state
              <>
                {/* Honeypot - hidden from users */}
                <input
                  type="text"
                  name="website"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  className={cls('honeypot')}
                  aria-hidden="true"
                />

                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <textarea
                    id={messageId}
                    name="message"
                    ref={textareaRef}
                    className={cls('textarea')}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={placeholder}
                    aria-required="true"
                    aria-label="Feedback message"
                    autoFocus
                  />
                </div>

                {collectEmail && (
                  <>
                    <input
                      id={emailId}
                      name="email"
                      type="email"
                      autoComplete="email"
                      className={cls('emailInput')}
                      value={email}
                      onChange={(e) => {
                        const wasEmpty = email.trim().length === 0
                        const nextEmail = e.target.value
                        setEmail(nextEmail)

                        if (!nextEmail.trim()) {
                          setSubscribe(false)
                        } else if (wasEmpty) {
                          setSubscribe(true)
                        }
                      }}
                      placeholder={emailPlaceholder}
                      aria-label={emailPlaceholder}
                    />
                    <div className={cls('subscribeRow')}>
                      <input
                        id={subscribeId}
                        name="subscribe"
                        type="checkbox"
                        className={cls('checkbox')}
                        checked={Boolean(email.trim() && subscribe)}
                        disabled={!email.trim()}
                        onChange={(e) => setSubscribe(e.target.checked)}
                      />
                      <label htmlFor={subscribeId} className={cls('subscribeLabel')}>
                        Email me when this is addressed
                      </label>
                    </div>
                  </>
                )}

                {screenshotPreview && (
                  <div className={cls('screenshotPreview')}>
                    <img src={screenshotPreview} alt="Screenshot" className={cls('previewImage')} />
                    <button
                      className={cls('removeButton')}
                      aria-label="Remove screenshot"
                      onClick={() => {
                        setScreenshotFile(null)
                        setScreenshotPreview(null)
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className={cls('fileInput')}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleScreenshotSelect(file)
                  }}
                />

                <div className={cls('actions')}>
                  <button
                    className={cls('actionButton', 'secondaryButton', 'screenshotButton')}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach screenshot"
                  >
                    {/* lucide Image */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    Screenshot
                  </button>
                  <button
                    className={cls('actionButton', 'primaryButton', (!message.trim() || isSending) && 'disabledButton')}
                    onClick={handleSend}
                    disabled={!message.trim() || isSending}
                  >
                    {isSending ? 'Sending...' : 'Send'}
                  </button>
                </div>

                <p className={cls('hint')}>
                  Tip: Paste (Cmd+V) or drag an image to attach a screenshot
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FeedbackWidget
