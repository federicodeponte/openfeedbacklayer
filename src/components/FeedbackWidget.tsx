'use client'

/**
 * OpenFeedbackLayer Widget
 * A floating feedback button with AI classification
 */

import React, { useState, useRef, useEffect, useId } from 'react'
import type { FeedbackWidgetProps } from '../lib/types'

/**
 * Character cap on the quoted user message in the success state.
 * Submissions longer than this clamp + show a "Show more" toggle so
 * a 2,000-char rant doesn't blow out the card height before the
 * user sees the "Tracked → review within 1 day" promise.
 */
const QUOTE_CLAMP = 280

const HOST_ACCENT = 'var(--accent, #2f7a59)'

const DEFAULT_COLORS = {
  primary: `var(--ofl-accent, ${HOST_ACCENT})`,
  success: 'var(--ofl-accent, var(--accent, #2f7a59))',
  text: 'var(--ofl-ink, var(--ink, #1a1a1a))',
  textSoft: 'var(--ofl-ink-soft, var(--ink-soft, rgba(26,26,26,.66)))',
  textMuted: 'var(--ofl-ink-mute, var(--ink-mute, rgba(26,26,26,.45)))',
  textFaint: 'var(--ofl-ink-faint, var(--ink-faint, rgba(26,26,26,.26)))',
  bg: 'var(--ofl-paper, var(--paper, #ffffff))',
  bgSubtle: 'var(--ofl-bg, var(--bg, #f7f7f6))',
  paperSubtle: 'var(--ofl-paper-2, var(--paper-2, #fbfbfa))',
  border: 'var(--ofl-line, var(--line, rgba(20,20,20,.08)))',
  borderStrong: 'var(--ofl-line-strong, var(--line-strong, rgba(20,20,20,.14)))',
  borderSoft: 'var(--ofl-line-soft, var(--line-soft, rgba(20,20,20,.045)))',
  accentSoft: 'var(--ofl-accent-soft, var(--accent-soft, rgba(47,122,89,.10)))',
  accentLine: 'var(--ofl-accent-line, var(--accent-line, rgba(47,122,89,.26)))',
  solid: 'var(--ofl-solid, var(--solid, #1a1a1a))',
  solidHover: 'var(--ofl-solid-2, var(--solid-2, #2c2c2c))',
  solidFg: 'var(--ofl-solid-fg, var(--solid-fg, #fbfbfb))',
  negative: 'var(--negative, #c0392b)',
  shadowSm: 'var(--shadow-sm, 0 1px 2px rgba(20,20,20,.05), 0 0 0 1px rgba(20,20,20,.05), inset 0 1px 0 rgba(255,255,255,.70))',
  shadowMd: 'var(--shadow-md, 0 6px 20px -8px rgba(20,20,20,.13), 0 0 0 1px rgba(20,20,20,.05), inset 0 1px 0 rgba(255,255,255,.70))',
  shadowPop: 'var(--shadow-pop, 0 22px 50px -16px rgba(20,20,20,.20), 0 0 0 1px rgba(20,20,20,.06), inset 0 1px 0 rgba(255,255,255,.70))',
  shadowBtn: 'var(--shadow-btn, 0 1px 2px rgba(20,20,20,.16), inset 0 1px 0 rgba(255,255,255,.18))',
  focus: 'var(--ofl-focus, var(--focus, 0 0 0 2px var(--ofl-paper, var(--paper, #ffffff)), 0 0 0 4px var(--ofl-ink, var(--ink, #1a1a1a))))',
  ease: 'var(--ease, cubic-bezier(0.22,1,0.36,1))',
  spring: 'var(--spring, cubic-bezier(0.32,1.06,0.5,1))',
  tFast: 'var(--t-fast, 110ms)',
  tBase: 'var(--t-base, 190ms)',
}

const STYLES = {
  container: {
    position: 'fixed',
    zIndex: 99999,
    // Inter first (Floom design system), system-ui as graceful fallback for
    // consumers that don't load Inter. Children inherit via fontFamily: inherit.
    fontFamily: 'var(--font, var(--font-sans, "Inter", "Inter Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif))',
    fontFeatureSettings: 'var(--font-feat, "cv11" 1, "ss01" 1, "calt" 1)',
    color: DEFAULT_COLORS.text,
    letterSpacing: 0,
    width: 48,
    height: 48,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 'var(--r-pill, 999px)',
    backgroundColor: DEFAULT_COLORS.text,
    color: DEFAULT_COLORS.bg,
    border: `1px solid ${DEFAULT_COLORS.borderStrong}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: DEFAULT_COLORS.shadowBtn,
    transition: `transform ${DEFAULT_COLORS.tBase} ${DEFAULT_COLORS.spring}, box-shadow ${DEFAULT_COLORS.tBase} ${DEFAULT_COLORS.ease}, background ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}`,
  },
  popup: {
    position: 'absolute',
    width: 320,
    // iPhone SE (320px viewport) was previously flush to the edge / overflowing.
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: '75vh',
    backgroundColor: DEFAULT_COLORS.bg,
    border: `1px solid ${DEFAULT_COLORS.border}`,
    borderRadius: 'var(--r-2xl, 13px)',
    boxShadow: DEFAULT_COLORS.shadowPop,
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
    fontWeight: 650,
    color: DEFAULT_COLORS.text,
    letterSpacing: 0,
    margin: 0,
  },
  closeButton: {
    fontFamily: 'inherit',
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--r-md, 7px)',
    cursor: 'pointer',
    width: 44,
    height: 44,
    padding: 10,
    color: DEFAULT_COLORS.textMuted,
    fontSize: 18,
    lineHeight: 1,
    transition: `color ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, background ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}`,
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
    borderRadius: 'var(--r-lg, 9px)',
    backgroundColor: DEFAULT_COLORS.bg,
    color: DEFAULT_COLORS.text,
    fontSize: 14,
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    lineHeight: 1.5,
    transition: `border-color ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, box-shadow ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, background ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}`,
  },
  emailInput: {
    width: '100%',
    height: 40,
    padding: '8px 12px',
    border: `1px solid ${DEFAULT_COLORS.border}`,
    borderRadius: 'var(--r-lg, 9px)',
    backgroundColor: DEFAULT_COLORS.bg,
    color: DEFAULT_COLORS.text,
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    marginTop: 8,
    transition: `border-color ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, box-shadow ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, background ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}`,
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
    accentColor: DEFAULT_COLORS.primary,
  },
  screenshotPreview: {
    marginTop: 8,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    maxHeight: 120,
    objectFit: 'cover',
    borderRadius: 'var(--r-lg, 9px)',
    border: `1px solid ${DEFAULT_COLORS.border}`,
  },
  removeButton: {
    fontFamily: 'inherit',
    position: 'absolute',
    top: 4,
    right: 4,
    width: 44,
    height: 44,
    borderRadius: 'var(--r-pill, 999px)',
    backgroundColor: 'color-mix(in srgb, var(--ofl-solid, var(--solid, #1a1a1a)) 60%, transparent)',
    color: DEFAULT_COLORS.solidFg,
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
    borderRadius: 'var(--r-md, 7px)',
    border: '1px solid transparent',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 550,
    letterSpacing: 0,
    transition: `transform ${DEFAULT_COLORS.tBase} ${DEFAULT_COLORS.spring}, border-color ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, background ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, box-shadow ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}`,
  },
  primaryButton: {
    backgroundColor: DEFAULT_COLORS.solid,
    color: DEFAULT_COLORS.solidFg,
    borderColor: DEFAULT_COLORS.solid,
    boxShadow: DEFAULT_COLORS.shadowBtn,
  },
  secondaryButton: {
    backgroundColor: DEFAULT_COLORS.bg,
    color: DEFAULT_COLORS.text,
    borderColor: DEFAULT_COLORS.border,
    boxShadow: DEFAULT_COLORS.shadowSm,
  },
  gotHeadline: {
    // Headline of the success state. Warm + human ("We got your message")
    // — not the AI's rephrase. Three independent agents converged on
    // showing the user's own words rather than an AI summary, because
    // the JTBD is "feel heard", which an echo accomplishes directly.
    fontSize: 15,
    fontWeight: 600,
    color: DEFAULT_COLORS.text,
    textAlign: 'center',
    margin: '0 0 12px',
    lineHeight: 1.4,
  },
  quotedMessage: {
    // The submitter's own words, quoted back as proof of receipt.
    // Clamped at QUOTE_CLAMP chars with a "Show more" toggle to keep
    // very long submissions from blowing out the card height.
    backgroundColor: DEFAULT_COLORS.bgSubtle,
    border: `1px solid ${DEFAULT_COLORS.border}`,
    borderRadius: 'var(--r-xl, 11px)',
    padding: '12px 14px',
    fontSize: 13,
    lineHeight: 1.55,
    color: DEFAULT_COLORS.text,
    margin: '0 0 14px',
    fontStyle: 'italic',
    fontFamily: 'inherit',
  },
  quoteShowMore: {
    background: 'transparent',
    border: 'none',
    color: DEFAULT_COLORS.textMuted,
    fontSize: 12,
    padding: '4px 0 0',
    margin: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textDecoration: 'underline',
    textDecorationColor: DEFAULT_COLORS.border,
    textUnderlineOffset: 3,
    display: 'block',
  },
  promiseLine: {
    fontSize: 13,
    color: DEFAULT_COLORS.textMuted,
    textAlign: 'center',
    margin: '0 0 14px',
    lineHeight: 1.5,
  },
  promiseLink: {
    // Real link: underline signals "click me".
    color: DEFAULT_COLORS.text,
    fontWeight: 500,
    textDecoration: 'underline',
    textDecorationColor: DEFAULT_COLORS.border,
    textUnderlineOffset: 3,
  },
  promiseRefText: {
    // Static issue-number reference (no link, private-repo deploys). Same
    // typographic weight as the link variant for visual continuity, but
    // NO underline — Federico flagged the underline-without-href as a
    // misleading affordance: it reads as clickable but does nothing.
    color: DEFAULT_COLORS.text,
    fontWeight: 500,
  },
  addedDetail: {
    // A follow-up detail the submitter added, echoed back persistently so
    // they can see it landed. Left-aligned, lighter than the main quote.
    display: 'block',
    textAlign: 'left',
    background: DEFAULT_COLORS.accentSoft,
    border: `1px solid ${DEFAULT_COLORS.accentLine}`,
    borderRadius: 'var(--r-lg, 9px)',
    padding: '8px 10px',
    margin: '0 0 10px',
  },
  addedDetailTag: {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: DEFAULT_COLORS.primary,
    marginBottom: 3,
  },
  addedDetailText: {
    display: 'block',
    fontSize: 13,
    lineHeight: 1.5,
    color: DEFAULT_COLORS.text,
  },
  successMessage: {
    textAlign: 'center',
    padding: 20,
  },
  checkmark: {
    width: 48,
    height: 48,
    borderRadius: 'var(--r-pill, 999px)',
    backgroundColor: DEFAULT_COLORS.success,
    color: DEFAULT_COLORS.solidFg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    margin: '0 auto 16px',
  },
  errorMark: {
    width: 48,
    height: 48,
    borderRadius: 'var(--r-pill, 999px)',
    backgroundColor: DEFAULT_COLORS.negative,
    color: DEFAULT_COLORS.solidFg,
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
    borderRadius: 'var(--r-lg, 9px)',
    backgroundColor: DEFAULT_COLORS.bg,
    color: DEFAULT_COLORS.text,
    transition: `border-color ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, box-shadow ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, background ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}`,
  },
  addEmailSubmit: {
    flex: 0,
    minHeight: 0,
    padding: '8px 14px',
  },
  refineToggle: {
    // Quiet text link beneath the promise + subscribe section. Says
    // "Add a detail" — clicking expands the inline refine textarea.
    // The framing matters: the user is ADDING context, not correcting
    // an AI summary (which was the gated "Not quite right?" framing
    // that Kimi flagged as making the user feel like unpaid QA).
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
    borderRadius: 'var(--r-lg, 9px)',
    backgroundColor: DEFAULT_COLORS.bg,
    color: DEFAULT_COLORS.text,
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    resize: 'vertical',
    transition: `border-color ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, box-shadow ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}, background ${DEFAULT_COLORS.tFast} ${DEFAULT_COLORS.ease}`,
  },
  refineError: {
    fontSize: 12,
    color: DEFAULT_COLORS.negative,
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
    flex: '0 0 auto',
    minHeight: 0,
    padding: '6px 12px',
    fontSize: 13,
    whiteSpace: 'nowrap',
  },
  refineSubmit: {
    // `flex: 0 0 auto` instead of `flex: 0` so the button sizes to its
    // content; `whiteSpace: nowrap` stops 'Send detail' from breaking
    // to two lines (Federico screenshot 2026-05-20 11:18).
    flex: '0 0 auto',
    minHeight: 0,
    padding: '6px 14px',
    fontSize: 13,
    whiteSpace: 'nowrap',
  },
  footer: {
    // Fixed footer of the popup — outside the scrolling body so its
    // contents (the Done button) are always visible regardless of how
    // tall the success card grows.
    padding: '12px 16px',
    borderTop: `1px solid ${DEFAULT_COLORS.border}`,
    flexShrink: 0,
  },
  doneButton: {
    width: '100%',
    marginTop: 0,
    backgroundColor: DEFAULT_COLORS.solid,
    color: DEFAULT_COLORS.solidFg,
    borderColor: DEFAULT_COLORS.solid,
    boxShadow: DEFAULT_COLORS.shadowBtn,
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
    return HOST_ACCENT
  }

  return value
}

function buildScopedCss(instanceId: string, primaryColor: string) {
  const scope = `ofl-${instanceId}`
  const scopedPrimaryColor = sanitizeCssCustomPropertyValue(primaryColor)
  const rules = Object.entries(STYLES).map(([name, style]) => {
    const declarations = styleToDeclarations(style)
    const customProperty = name === 'container' && primaryColor !== DEFAULT_COLORS.primary
      ? ` --ofl-accent: ${scopedPrimaryColor}; --ofl-accent-soft: color-mix(in srgb, ${scopedPrimaryColor} 10%, transparent); --ofl-accent-line: color-mix(in srgb, ${scopedPrimaryColor} 26%, transparent);`
      : ''

    return `.${scope}-${name} { ${declarations}${customProperty} }`
  })

  for (const [name, style] of Object.entries(POSITION_STYLES)) {
    rules.push(`.${scope}-${name} { ${styleToDeclarations(style)} }`)
  }

  rules.push(
    `.${scope}-body { scrollbar-width: thin; scrollbar-color: ${DEFAULT_COLORS.borderStrong} transparent; }`,
    `.${scope}-body::-webkit-scrollbar { width: 6px; }`,
    `.${scope}-body::-webkit-scrollbar-track { background: transparent; }`,
    `.${scope}-body::-webkit-scrollbar-thumb { background: ${DEFAULT_COLORS.borderStrong}; border-radius: 999px; }`,
    `.${scope}-button:hover { transform: translateY(-1px); box-shadow: ${DEFAULT_COLORS.shadowPop}; }`,
    `.${scope}-button:active { transform: scale(.965); }`,
    `.${scope}-button:focus-visible { outline: none; box-shadow: 0 0 0 3px ${DEFAULT_COLORS.bg}, 0 0 0 5px ${DEFAULT_COLORS.primary}; }`,
    `.${scope}-actionButton:hover:not(:disabled) { transform: translateY(-1px); }`,
    `.${scope}-primaryButton:hover:not(:disabled) { background: ${DEFAULT_COLORS.solidHover}; border-color: ${DEFAULT_COLORS.solidHover}; }`,
    `.${scope}-secondaryButton:hover:not(:disabled) { background: ${DEFAULT_COLORS.bgSubtle}; border-color: ${DEFAULT_COLORS.borderStrong}; }`,
    `.${scope}-doneButton:hover:not(:disabled) { background: ${DEFAULT_COLORS.solidHover}; border-color: ${DEFAULT_COLORS.solidHover}; }`,
    `.${scope}-actionButton:active:not(:disabled) { transform: scale(.98); }`,
    `.${scope}-actionButton:focus-visible, .${scope}-closeButton:focus-visible, .${scope}-quoteShowMore:focus-visible, .${scope}-refineToggle:focus-visible { outline: none; box-shadow: ${DEFAULT_COLORS.focus}; border-color: ${DEFAULT_COLORS.borderStrong}; }`,
    `.${scope}-textarea:focus-visible, .${scope}-emailInput:focus-visible, .${scope}-addEmailInput:focus-visible, .${scope}-refineTextarea:focus-visible { outline: none; border-color: ${DEFAULT_COLORS.primary}; box-shadow: 0 0 0 3px color-mix(in srgb, ${DEFAULT_COLORS.primary} 18%, transparent); }`,
    `.${scope}-textarea::placeholder, .${scope}-emailInput::placeholder, .${scope}-addEmailInput::placeholder, .${scope}-refineTextarea::placeholder { color: ${DEFAULT_COLORS.textMuted}; }`,
    `.${scope}-actionButton:disabled, .${scope}-textarea:disabled, .${scope}-emailInput:disabled, .${scope}-addEmailInput:disabled, .${scope}-refineTextarea:disabled { cursor: not-allowed; }`,
    `.${scope}-closeButton:hover { color: ${DEFAULT_COLORS.text}; background: ${DEFAULT_COLORS.bgSubtle}; border-radius: var(--r-md, 7px); }`,
    `@media (prefers-reduced-motion: reduce) { .${scope}-button, .${scope}-closeButton, .${scope}-actionButton, .${scope}-textarea, .${scope}-emailInput, .${scope}-addEmailInput, .${scope}-refineTextarea { transition: none !important; transform: none !important; } }`,
  )

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
  publicIssueTracker = false,
}: FeedbackWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [email, setEmail] = useState('')
  const [subscribe, setSubscribe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [honeypot, setHoneypot] = useState('')
  // Post-submit state. feedbackId returned by POST is used by PATCH for the
  // follow-up "add a detail" flow + subscribe toggle. submittedMessage is
  // the submitter's exact original text, echoed back in the success state
  // (this is the "We got your message" receipt — three independent agents
  // converged on showing user-own-words rather than the AI rephrase).
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [submittedMessage, setSubmittedMessage] = useState<string>('')
  const [githubIssueNumber, setGithubIssueNumber] = useState<number | null>(null)
  const [githubIssueUrl, setGithubIssueUrl] = useState<string | null>(null)
  const [quoteExpanded, setQuoteExpanded] = useState(false)
  // Two independent in-flight flags. They MUST stay separate: a single
  // shared `patching` flag made the Subscribe button flash "Saving…" while
  // a refine PATCH was in flight (and vice-versa) even though the email
  // field was empty — Federico screenshot 2026-05-21 13:15.
  const [subscribing, setSubscribing] = useState(false)
  const [refining, setRefining] = useState(false)
  // Lets a submitter who skipped the email field still subscribe to updates
  // after seeing the success state.
  const [postSubmitEmailDraft, setPostSubmitEmailDraft] = useState('')
  // "Add a detail" escape hatch — quiet text link that expands a textarea.
  // Each successfully-sent detail is kept in addedDetails and shown back
  // persistently in the card, so the submitter gets real proof the detail
  // landed (the old 4s-fade "Thanks, added" gave no lasting feedback).
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineDraft, setRefineDraft] = useState('')
  const [refineError, setRefineError] = useState<string | null>(null)
  const [addedDetails, setAddedDetails] = useState<string[]>([])


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
        setFeedbackId(null)
        setSubmittedMessage('')
        setGithubIssueNumber(null)
        setGithubIssueUrl(null)
        setQuoteExpanded(false)
        setRefineOpen(false)
        setRefineDraft('')
        setRefineError(null)
        setAddedDetails([])
        setSubscribing(false)
        setRefining(false)
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
      setSubmittedMessage(message.trim())
      setGithubIssueNumber(
        typeof result.github_issue_number === 'number' ? result.github_issue_number : null,
      )
      setGithubIssueUrl(
        typeof result.github_issue_url === 'string' ? result.github_issue_url : null,
      )

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

  // PATCH the feedback row after submit. Used only by the subscribe flow
  // (toggle + add-email). Drives the `subscribing` flag — never `refining`,
  // so the refine button can't show a spurious loading label.
  const sendPatch = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!feedbackId) return false
    setSubscribing(true)
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
      setSubscribing(false)
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

  // Refine flow: submitter wants to add a detail after seeing the success
  // state. We PATCH the follow-up to the server (re-runs the AI server-side
  // for the team's classification). On success the detail is pushed into
  // addedDetails and shown back persistently in the card — that IS the
  // feedback: the user sees their detail is now part of the report.
  const handleSubmitRefine = async () => {
    const followUp = refineDraft.trim()
    if (!followUp || !feedbackId || refining) return

    setRefineError(null)
    setRefining(true)
    try {
      const res = await fetch(`${apiEndpoint}/${feedbackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up: followUp }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setRefineError(body?.error || "We couldn't add that - please try again.")
        return
      }

      // Persistent acknowledgement: the detail is now shown in the card.
      setAddedDetails((prev) => [...prev, followUp])
      setRefineDraft('')
      setRefineOpen(false)
    } catch (err) {
      console.error('[OpenFeedbackLayer] Refine error:', err)
      setRefineError("We couldn't add that - please try again.")
    } finally {
      setRefining(false)
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
          stroke="currentColor"
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
              // Success state — final synthesis after 4-agent UX review
              // (Claude+Codex+Kimi+NVIDIA). The headline is "We got your
              // message" + the user's own quoted text as proof of receipt,
              // followed by a human "we'll review within 1 day" promise +
              // GitHub issue link. AI title / short_summary / category /
              // priority chips all stayed internal (team-side only).
              <div className={cls('successMessage')} role="status" aria-live="polite">
                <div className={cls('checkmark')}>✓</div>
                <p className={cls('gotHeadline')}>We got your message</p>
                {submittedMessage && (
                  <blockquote className={cls('quotedMessage')}>
                    {quoteExpanded || submittedMessage.length <= QUOTE_CLAMP
                      ? `“${submittedMessage}”`
                      : `“${submittedMessage.slice(0, QUOTE_CLAMP).trimEnd()}…”`}
                    {submittedMessage.length > QUOTE_CLAMP && !quoteExpanded && (
                      <button
                        type="button"
                        className={cls('quoteShowMore')}
                        onClick={() => setQuoteExpanded(true)}
                      >
                        Show more
                      </button>
                    )}
                  </blockquote>
                )}

                {/* Each detail the submitter added afterwards, echoed back
                    persistently — this is the visible proof the detail
                    landed (the old 4s "Thanks, added" toast gave none). */}
                {addedDetails.map((detail, i) => (
                  <div key={i} className={cls('addedDetail')}>
                    <span className={cls('addedDetailTag')}>You added</span>
                    <span className={cls('addedDetailText')}>{detail}</span>
                  </div>
                ))}

                <p className={cls('promiseLine')}>
                  We&rsquo;ll review this within 1 day.
                  {githubIssueNumber && (
                    <>
                      <br />
                      Tracked as{' '}
                      {publicIssueTracker && githubIssueUrl ? (
                        // Only render the issue link when the host opts in
                        // via publicIssueTracker — most production deploys
                        // file issues into a PRIVATE maintainer repo where
                        // the link 404s for end users.
                        <a
                          href={githubIssueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cls('promiseLink')}
                        >
                          issue #{githubIssueNumber} ↗
                        </a>
                      ) : (
                        <span className={cls('promiseRefText')}>issue #{githubIssueNumber}</span>
                      )}
                    </>
                  )}
                </p>

                {/* Post-submit subscribe section. If an email was entered at
                    submit time, show a toggle so the submitter can flip
                    subscribe. If no email was entered, show an "Add email to
                    get updates" input so they can still subscribe after the
                    fact. Hidden while the refine textarea is open to keep the
                    card from getting button-heavy (Federico 2026-05-21). */}
                {feedbackId && !refineOpen && email.trim() && (
                  <label
                    htmlFor={`${subscribeId}-after`}
                    className={cls('subscribeAfterLabel')}
                  >
                    <input
                      id={`${subscribeId}-after`}
                      type="checkbox"
                      checked={subscribe}
                      disabled={subscribing}
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

                {feedbackId && !refineOpen && !email.trim() && (
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
                        disabled={subscribing}
                        className={cls('addEmailInput')}
                      />
                      <button
                        type="submit"
                        disabled={subscribing || !postSubmitEmailDraft.trim()}
                        className={cls('actionButton', 'primaryButton', 'addEmailSubmit')}
                      >
                        {subscribing ? 'Saving…' : 'Subscribe'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Refine ("Add a detail") — quiet escape hatch. */}
                {feedbackId && !refineOpen && (
                  <button
                    type="button"
                    className={cls('refineToggle')}
                    onClick={() => {
                      setRefineOpen(true)
                      setRefineError(null)
                    }}
                  >
                    {addedDetails.length > 0 ? 'Add another detail' : 'Add a detail'}
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
                      Anything else to add?
                    </label>
                    <textarea
                      id={`${messageId}-refine`}
                      className={cls('refineTextarea')}
                      placeholder="e.g. 'Actually it's Linux not Mac. The spinner times out at ~30s.'"
                      value={refineDraft}
                      onChange={(e) => setRefineDraft(e.target.value)}
                      disabled={refining}
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
                        disabled={refining}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className={cls('actionButton', 'primaryButton', 'refineSubmit')}
                        disabled={refining || !refineDraft.trim()}
                      >
                        {refining ? 'Sending…' : 'Send detail'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              // Input state
              <>
                {/* Honeypot — a real bot fills `website`, humans never see
                    it. Wrapped in an aria-hidden div (more reliably honored
                    than aria-hidden on the input itself) so assistive tech
                    and a11y snapshots fully skip the unlabelled control. */}
                <div aria-hidden="true" className={cls('honeypot')}>
                  <input
                    type="text"
                    name="website"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

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

          {/* Fixed footer — Done lives OUTSIDE the scrolling body so it is
              always visible no matter how tall the success card grows
              (Federico 2026-05-21: "Done only appears on scroll"). Hidden
              while the refine textarea is open — the actions there are
              Cancel / Send detail, and showing Done too made the card
              button-heavy. */}
          {isSent && !error && !refineOpen && (
            <div className={cls('footer')}>
              <button
                className={cls('actionButton', 'secondaryButton', 'doneButton')}
                onClick={handleClose}
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default FeedbackWidget
