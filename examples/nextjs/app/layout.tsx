import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { FeedbackWidgetClient } from './feedback-widget-client'

export const metadata: Metadata = {
  title: 'OpenFeedbackLayer Example',
  description: 'Minimal Next.js example for OpenFeedbackLayer',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {children}
        <FeedbackWidgetClient />
      </body>
    </html>
  )
}
