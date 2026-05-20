/**
 * OpenFeedbackLayer Types
 */

export interface FeedbackData {
  id?: string
  message_raw: string
  page_url: string
  user_agent?: string
  screenshot_url?: string
  ai_data?: FeedbackAIData | null
  project_id?: string
  status?: 'new' | 'in_progress' | 'resolved' | 'closed'
  submitter_email?: string | null
  subscribe?: boolean
  github_issue_number?: number | null
  github_issue_url?: string | null
  journey_stage?: JourneyStage
  last_emailed_stage?: JourneyStage | null
  created_at?: string
}

export type JourneyStage = 'received' | 'triaged' | 'in_progress' | 'shipped' | 'wont_fix'

export interface FeedbackAIData {
  title: string
  short_summary: string
  key_details: string[]
  suggested_category: 'bug' | 'feature' | 'question' | 'billing' | 'praise' | 'other'
  suggested_feature_area: string  // Free-form: "export", "upload", "dashboard", etc.
  suggested_priority: 'low' | 'medium' | 'high'
  steps: string[]
  expected: string | null
  confidence: number
  clarifying_questions: string[]
}

export interface FeedbackWidgetProps {
  /** API endpoint for submitting feedback (default: /api/feedback) */
  apiEndpoint?: string
  /** Project identifier for multi-project setups */
  projectId?: string
  /** Position of the widget */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** Primary color for the widget */
  primaryColor?: string
  /** Custom text for the button tooltip */
  buttonText?: string
  /** Custom placeholder for the message input */
  placeholder?: string
  /** Collect an optional submitter email (default: true) */
  collectEmail?: boolean
  /** Custom placeholder for the email input */
  emailPlaceholder?: string
  /** Called after feedback is successfully submitted */
  onSubmit?: (data: FeedbackData) => void
  /** Called on error */
  onError?: (error: Error) => void
}

export interface FeedbackConfig {
  /** Gemini API key for AI classification (server-side only) */
  geminiApiKey?: string
  /** Supabase URL */
  supabaseUrl?: string
  /** Supabase anon key */
  supabaseAnonKey?: string
  /** Supabase service role key (for server-side) */
  supabaseServiceKey?: string
  /** Resend API key for email notifications */
  resendApiKey?: string
  /** Email to notify on new feedback */
  notifyEmail?: string
  /** Rate limit per IP per minute */
  rateLimit?: number
}
