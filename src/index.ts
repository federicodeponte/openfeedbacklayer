/**
 * OpenFeedbackLayer
 * Open-source feedback widget with AI classification
 */

// Components
export { FeedbackWidget } from './components/FeedbackWidget'
export { default } from './components/FeedbackWidget'

// AI Service
export { analyzeFeedback } from './lib/ai-service'

// Types
export type {
  FeedbackData,
  FeedbackAIData,
  FeedbackWidgetProps,
  FeedbackConfig,
} from './lib/types'
