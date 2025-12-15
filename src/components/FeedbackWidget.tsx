'use client'

/**
 * OpenFeedbackLayer Widget
 * A floating feedback button with AI classification
 */

import React, { useState, useRef, useEffect } from 'react'
import type { FeedbackWidgetProps, FeedbackData } from '../lib/types'

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
  onSubmit,
  onError,
}: FeedbackWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [classification, setClassification] = useState<{
    category: string
    feature_area: string
    priority: string
  } | null>(null)
  const [honeypot, setHoneypot] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Position styles
  const positionStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 20, right: 20 },
    'bottom-left': { bottom: 20, left: 20 },
    'top-right': { top: 20, right: 20 },
    'top-left': { top: 20, left: 20 },
  }

  // Reset state when closing
  const handleClose = () => {
    setIsOpen(false)
    if (isSent) {
      // Reset after closing sent state
      setTimeout(() => {
        setMessage('')
        setScreenshotFile(null)
        setScreenshotPreview(null)
        setIsSent(false)
        setAiResponse(null)
        setClassification(null)
      }, 300)
    }
  }

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

    try {
      const formData = new FormData()
      formData.append('message', message)
      formData.append('website', honeypot) // Honeypot field

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

      if (aiData) {
        setClassification({
          category: aiData.suggested_category || 'other',
          feature_area: aiData.suggested_feature_area || 'general',
          priority: formatPriority(aiData.suggested_priority || 'medium'),
        })
        setAiResponse(aiData.short_summary || 'Thank you for your feedback!')
      } else {
        setClassification({
          category: 'feedback',
          feature_area: 'general',
          priority: 'P1',
        })
        setAiResponse('Thank you for your feedback!')
      }

      setIsSent(true)

      // Callback
      if (onSubmit) {
        onSubmit({
          message_raw: message,
          page_url: typeof window !== 'undefined' ? window.location.href : '',
          ai_data: aiData,
        })
      }
    } catch (error) {
      console.error('[OpenFeedbackLayer] Send error:', error)
      setClassification({
        category: 'feedback',
        feature_area: 'general',
        priority: 'P1',
      })
      setAiResponse('Thank you for your feedback!')
      setIsSent(true)

      if (onError && error instanceof Error) {
        onError(error)
      }
    } finally {
      setIsSending(false)
    }
  }

  // Styles
  const styles = {
    container: {
      position: 'fixed' as const,
      zIndex: 99999,
      fontFamily: 'system-ui, -apple-system, sans-serif',
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
      width: 320,
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
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 4,
      color: DEFAULT_COLORS.textMuted,
      fontSize: 18,
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
      position: 'absolute' as const,
      top: 4,
      right: 4,
      width: 24,
      height: 24,
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
      flex: 1,
      padding: '10px 16px',
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
    hint: {
      fontSize: 12,
      color: DEFAULT_COLORS.textMuted,
      marginTop: 8,
    },
  }

  return (
    <div style={styles.container}>
      {!isOpen ? (
        // Closed state - floating button
        <button
          style={styles.button}
          onClick={() => setIsOpen(true)}
          title={buttonText}
          aria-label={buttonText}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      ) : (
        // Open state - popup
        <div style={styles.popup}>
          <div style={styles.header}>
            <h3 style={styles.title}>Send feedback</h3>
            <button style={styles.closeButton} onClick={handleClose}>
              ×
            </button>
          </div>

          <div style={styles.body}>
            {isSent ? (
              // Success state
              <div style={styles.successMessage}>
                <div style={styles.checkmark}>✓</div>
                <p style={{ fontSize: 14, color: DEFAULT_COLORS.text, marginBottom: 12 }}>
                  {aiResponse}
                </p>
                {classification && (
                  <div>
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: '#dbeafe',
                        color: '#1e40af',
                      }}
                    >
                      {classification.category}
                    </span>
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: '#f3e8ff',
                        color: '#7c3aed',
                      }}
                    >
                      {classification.feature_area}
                    </span>
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor:
                          classification.priority === 'P0'
                            ? '#fee2e2'
                            : classification.priority === 'P1'
                            ? '#fef3c7'
                            : '#dcfce7',
                        color:
                          classification.priority === 'P0'
                            ? '#dc2626'
                            : classification.priority === 'P1'
                            ? '#d97706'
                            : '#16a34a',
                      }}
                    >
                      {classification.priority}
                    </span>
                  </div>
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
                    ref={textareaRef}
                    style={styles.textarea}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={placeholder}
                    autoFocus
                  />
                </div>

                {screenshotPreview && (
                  <div style={styles.screenshotPreview}>
                    <img src={screenshotPreview} alt="Screenshot" style={styles.previewImage} />
                    <button
                      style={styles.removeButton}
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
                    style={{ ...styles.actionButton, ...styles.secondaryButton }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📷 Screenshot
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
