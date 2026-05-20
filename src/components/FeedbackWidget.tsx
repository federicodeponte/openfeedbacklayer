'use client'

/**
 * OpenFeedbackLayer Widget
 * A floating feedback button with AI classification
 */

import React, { useState, useRef, useEffect, useId } from 'react'
import type { FeedbackWidgetProps } from '../lib/types'

const DEFAULT_COLORS = {
  primary: '#2563eb', // blue-600
  primaryHover: '#1d4ed8', // blue-700
  success: '#16a34a', // green-600
  text: '#1f2937', // gray-800
  textMuted: '#6b7280', // gray-500
  bg: '#ffffff',
  border: '#e5e7eb', // gray-200
}

export function FeedbackWidget({
  apiEndpoint = '/api/feedback',
  projectId,
  position = 'bottom-right',
  primaryColor = DEFAULT_COLORS.primary,
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
  // so the submitter can flip subscribe + correct AI classification mistakes.
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<'category' | 'feature_area' | 'priority' | null>(null)
  const [patching, setPatching] = useState(false)
  const [featureAreaDraft, setFeatureAreaDraft] = useState('')

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

  // Position styles
  const positionStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 20, right: 20 },
    'bottom-left': { bottom: 20, left: 20 },
    'top-right': { top: 20, right: 20 },
    'top-left': { top: 20, left: 20 },
  }

  const popupAnchorStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 0, right: 0 },
    'bottom-left': { bottom: 0, left: 0 },
    'top-right': { top: 0, right: 0 },
    'top-left': { top: 0, left: 0 },
  }

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
        setEditingField(null)
        setFeatureAreaDraft('')
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
        setAiResponse(aiData.short_summary || 'Thanks - your feedback is in.')
      } else {
        setClassification({
          category: 'feedback',
          feature_area: 'general',
          priority: 'P1',
        })
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

  const handleEditClassification = async (
    field: 'suggested_category' | 'suggested_feature_area' | 'suggested_priority',
    value: string,
  ) => {
    if (!classification) return
    const map = {
      suggested_category: 'category' as const,
      suggested_feature_area: 'feature_area' as const,
      suggested_priority: 'priority' as const,
    }
    const localField = map[field]
    const localValue = field === 'suggested_priority' ? formatPriority(value) : value
    const prev = { ...classification }
    setClassification({ ...classification, [localField]: localValue })
    setEditingField(null)
    const ok = await sendPatch({ [field]: value })
    if (!ok) setClassification(prev)
  }

  // Styles
  const styles = {
    container: {
      position: 'fixed' as const,
      zIndex: 99999,
      // Inter first (Floom design system), system-ui as graceful fallback for
      // consumers that don't load Inter. Children inherit via fontFamily: inherit.
      fontFamily: '"Inter", "Inter Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      width: 48,
      height: 48,
      ...positionStyles[position],
    },
    button: {
      width: 48,
      height: 48,
      borderRadius: '50%',
      backgroundColor: primaryColor,
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      transition: 'transform 0.2s, box-shadow 0.2s',
    },
    popup: {
      position: 'absolute' as const,
      width: 320,
      // iPhone SE (320px viewport) was previously flush to the edge / overflowing.
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: '75vh',
      backgroundColor: DEFAULT_COLORS.bg,
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
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
      position: 'absolute' as const,
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap' as const,
      border: 0,
    },
    body: {
      padding: 16,
      overflowY: 'auto' as const,
      flex: 1,
    },
    textarea: {
      width: '100%',
      minHeight: 100,
      padding: 12,
      border: `1px solid ${DEFAULT_COLORS.border}`,
      borderRadius: 8,
      fontSize: 14,
      resize: 'vertical' as const,
      fontFamily: 'inherit',
      boxSizing: 'border-box' as const,
    },
    emailInput: {
      width: '100%',
      height: 40,
      padding: '8px 12px',
      border: `1px solid ${DEFAULT_COLORS.border}`,
      borderRadius: 8,
      fontSize: 14,
      fontFamily: 'inherit',
      boxSizing: 'border-box' as const,
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
      position: 'relative' as const,
    },
    previewImage: {
      width: '100%',
      maxHeight: 120,
      objectFit: 'cover' as const,
      borderRadius: 8,
      border: `1px solid ${DEFAULT_COLORS.border}`,
    },
    removeButton: {
      fontFamily: 'inherit',
      position: 'absolute' as const,
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
      backgroundColor: primaryColor,
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
    badgeButton: {
      // Make the colored badge clickable to enter edit mode without changing
      // the visual treatment; cursor signals it's actionable.
      fontFamily: 'inherit',
      border: 'none',
      cursor: 'pointer',
      // Same vertical alignment as <span> badges so heights match in the row.
      lineHeight: 1,
    },
    editSelect: {
      fontFamily: 'inherit',
      fontSize: 12,
      padding: '4px 6px',
      borderRadius: 4,
      border: `1px solid ${DEFAULT_COLORS.border}`,
      marginRight: 6,
      marginBottom: 6,
      backgroundColor: DEFAULT_COLORS.bg,
      color: DEFAULT_COLORS.text,
    },
    editInput: {
      fontFamily: 'inherit',
      fontSize: 12,
      padding: '4px 6px',
      borderRadius: 4,
      border: `1px solid ${DEFAULT_COLORS.border}`,
      marginRight: 6,
      marginBottom: 6,
      width: 110,
      backgroundColor: DEFAULT_COLORS.bg,
      color: DEFAULT_COLORS.text,
    },
    successMessage: {
      textAlign: 'center' as const,
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
  }

  return (
    <div style={styles.container}>
      <button
        ref={fabRef}
        style={styles.button}
        onClick={() => setIsOpen(true)}
        title={buttonText}
        aria-label={buttonText}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={popupId}
        tabIndex={isOpen ? -1 : 0}
      >
        {/* lucide MessageSquareText — uniform stroke-1.75 per Floom UI bar */}
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
          style={{ ...styles.popup, ...popupAnchorStyles[position] }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <div style={styles.header}>
            <h3 id={titleId} style={styles.title}>Send feedback</h3>
            <button style={styles.closeButton} onClick={handleClose} aria-label="Close feedback">
              ×
            </button>
          </div>

          <div style={styles.body}>
            <p id={descriptionId} style={styles.srOnly}>
              Send a feedback message with an optional screenshot and email address.
            </p>

            {error ? (
              <div style={styles.successMessage} role="alert" aria-live="assertive">
                <div style={styles.errorMark}>✕</div>
                <p style={{ fontSize: 14, color: DEFAULT_COLORS.text, marginBottom: 12 }}>
                  {error}
                </p>
                <div style={styles.actions}>
                  <button
                    style={{ ...styles.actionButton, ...styles.primaryButton }}
                    onClick={handleSend}
                    disabled={isSending}
                  >
                    {isSending ? 'Sending...' : 'Retry'}
                  </button>
                  <button
                    style={{ ...styles.actionButton, ...styles.secondaryButton }}
                    onClick={handleClose}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : isSent ? (
              // Success state - editable post-submit
              <div style={styles.successMessage} role="status" aria-live="polite">
                <div style={styles.checkmark}>✓</div>
                <p style={{ fontSize: 14, color: DEFAULT_COLORS.text, marginBottom: 12 }}>
                  {aiResponse}
                </p>

                {/* Post-submit subscribe toggle - change your mind anytime */}
                {email.trim() && feedbackId && (
                  <label
                    htmlFor={`${subscribeId}-after`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      justifyContent: 'center',
                      fontSize: 12,
                      color: DEFAULT_COLORS.textMuted,
                      marginBottom: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      id={`${subscribeId}-after`}
                      type="checkbox"
                      checked={subscribe}
                      disabled={patching}
                      onChange={(e) => handleToggleSubscribeAfterSend(e.target.checked)}
                      style={{ width: 14, height: 14, margin: 0, cursor: 'pointer' }}
                    />
                    {subscribe ? (
                      <span>
                        We'll email <span style={{ wordBreak: 'break-all' }}>{email.trim()}</span> with updates
                      </span>
                    ) : (
                      <span>Email me when this is addressed</span>
                    )}
                  </label>
                )}

                {/* Editable classification badges - click to correct the AI */}
                {classification && feedbackId && (
                  <div style={{ marginBottom: 4 }}>
                    {editingField === 'category' ? (
                      <select
                        autoFocus
                        defaultValue={classification.category}
                        disabled={patching}
                        onBlur={() => setEditingField(null)}
                        onChange={(e) => handleEditClassification('suggested_category', e.target.value)}
                        style={{ ...styles.editSelect }}
                        aria-label="Edit category"
                      >
                        {['bug', 'feature', 'question', 'billing', 'praise', 'other'].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingField('category')}
                        style={{ ...styles.badge, ...styles.badgeButton, backgroundColor: '#dbeafe', color: '#1e40af' }}
                        aria-label={`Category: ${classification.category} (click to edit)`}
                        title="Click to edit"
                      >
                        {classification.category}
                      </button>
                    )}

                    {editingField === 'feature_area' ? (
                      <input
                        autoFocus
                        type="text"
                        defaultValue={classification.feature_area}
                        disabled={patching}
                        maxLength={64}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v && v !== classification.feature_area) {
                            handleEditClassification('suggested_feature_area', v)
                          } else {
                            setEditingField(null)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                          if (e.key === 'Escape') setEditingField(null)
                        }}
                        style={{ ...styles.editInput }}
                        aria-label="Edit feature area"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingField('feature_area')}
                        style={{ ...styles.badge, ...styles.badgeButton, backgroundColor: '#f3e8ff', color: '#7c3aed' }}
                        aria-label={`Area: ${classification.feature_area} (click to edit)`}
                        title="Click to edit"
                      >
                        {classification.feature_area}
                      </button>
                    )}

                    {editingField === 'priority' ? (
                      <select
                        autoFocus
                        defaultValue={
                          classification.priority === 'P0' ? 'high' : classification.priority === 'P1' ? 'medium' : 'low'
                        }
                        disabled={patching}
                        onBlur={() => setEditingField(null)}
                        onChange={(e) => handleEditClassification('suggested_priority', e.target.value)}
                        style={{ ...styles.editSelect }}
                        aria-label="Edit priority"
                      >
                        <option value="high">P0 (high)</option>
                        <option value="medium">P1 (medium)</option>
                        <option value="low">P2 (low)</option>
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingField('priority')}
                        style={{
                          ...styles.badge,
                          ...styles.badgeButton,
                          backgroundColor:
                            classification.priority === 'P0' ? '#fee2e2' :
                            classification.priority === 'P1' ? '#fef3c7' : '#dcfce7',
                          color:
                            classification.priority === 'P0' ? '#dc2626' :
                            classification.priority === 'P1' ? '#d97706' : '#16a34a',
                        }}
                        aria-label={`Priority: ${classification.priority} (click to edit)`}
                        title="Click to edit"
                      >
                        {classification.priority}
                      </button>
                    )}
                  </div>
                )}

                {feedbackId && (
                  <p style={{ fontSize: 11, color: DEFAULT_COLORS.textMuted, marginTop: 8, marginBottom: 0 }}>
                    Click any badge to correct it
                  </p>
                )}

                <button
                  style={{ ...styles.actionButton, ...styles.secondaryButton, marginTop: 16 }}
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
                  style={{
                    position: 'absolute',
                    left: '-9999px',
                    opacity: 0,
                    height: 0,
                    width: 0,
                    pointerEvents: 'none',
                  }}
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
                    style={styles.textarea}
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
                      style={styles.emailInput}
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
                    <div style={styles.subscribeRow}>
                      <input
                        id={subscribeId}
                        name="subscribe"
                        type="checkbox"
                        style={styles.checkbox}
                        checked={Boolean(email.trim() && subscribe)}
                        disabled={!email.trim()}
                        onChange={(e) => setSubscribe(e.target.checked)}
                      />
                      <label htmlFor={subscribeId} style={styles.subscribeLabel}>
                        Email me when this is addressed
                      </label>
                    </div>
                  </>
                )}

                {screenshotPreview && (
                  <div style={styles.screenshotPreview}>
                    <img src={screenshotPreview} alt="Screenshot" style={styles.previewImage} />
                    <button
                      style={styles.removeButton}
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
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleScreenshotSelect(file)
                  }}
                />

                <div style={styles.actions}>
                  <button
                    style={{ ...styles.actionButton, ...styles.secondaryButton, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
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
                    style={{
                      ...styles.actionButton,
                      ...styles.primaryButton,
                      opacity: !message.trim() || isSending ? 0.6 : 1,
                    }}
                    onClick={handleSend}
                    disabled={!message.trim() || isSending}
                  >
                    {isSending ? 'Sending...' : 'Send'}
                  </button>
                </div>

                <p style={styles.hint}>
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
