# OpenFeedbackLayer

Open-source feedback widget with AI classification. A drop-in React component that captures user feedback, automatically classifies it using Gemini AI, and stores it in Supabase.

## Features

- **Floating feedback button** - Non-intrusive, appears in corner of screen
- **Screenshot support** - Paste, drag & drop, or click to attach images
- **AI classification** - Automatically categorizes feedback (bug/feature/question/billing/praise)
- **Feature area detection** - AI identifies which part of your product is mentioned
- **Priority scoring** - P0/P1/P2 based on urgency
- **Bot protection** - Honeypot field + rate limiting
- **Email notifications** - Get notified via Resend on new feedback
- **Supabase storage** - Screenshots stored in Supabase Storage

## Quick Start

### 1. Install the package

```bash
npm install openfeedbacklayer
# or
pnpm add openfeedbacklayer
# or
yarn add openfeedbacklayer
```

### 2. Add the widget to your app

```tsx
// app/layout.tsx or any layout component
import { FeedbackWidget } from 'openfeedbacklayer'

export default function Layout({ children }) {
  return (
    <html>
      <body>
        {children}
        <FeedbackWidget />
      </body>
    </html>
  )
}
```

### 3. Set up the API route

Copy the API route template to your Next.js app:

```bash
cp node_modules/openfeedbacklayer/src/api/feedback/route.ts app/api/feedback/route.ts
```

Or create `app/api/feedback/route.ts` manually - see [API Route Template](./src/api/feedback/route.ts).

### 4. Set up Supabase

Run the migration in your Supabase SQL Editor:

```bash
# Copy the migration
cat node_modules/openfeedbacklayer/supabase/migrations/001_create_feedback.sql
```

Or see [Migration SQL](./supabase/migrations/001_create_feedback.sql).

### 5. Add environment variables

```env
# .env.local

# Required
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx

# For AI classification
GEMINI_API_KEY=AIzaSyxxx

# Optional: Email notifications
RESEND_API_KEY=re_xxx
FEEDBACK_NOTIFY_EMAIL=you@example.com
```

## Configuration

### Widget Props

```tsx
<FeedbackWidget
  apiEndpoint="/api/feedback"       // API endpoint (default: /api/feedback)
  projectId="my-app"                // For multi-project setups
  position="bottom-right"           // bottom-right | bottom-left | top-right | top-left
  primaryColor="#2563eb"            // Button color
  buttonText="Feedback"             // Tooltip text
  placeholder="Describe your issue..." // Input placeholder
  onSubmit={(data) => {}}           // Callback after submit
  onError={(error) => {}}           // Error callback
/>
```

### AI Classification Output

The AI returns structured data:

```json
{
  "title": "Export button not working",
  "short_summary": "User reports the export button has no effect when clicked.",
  "key_details": ["export button", "no response", "dashboard page"],
  "suggested_category": "bug",
  "suggested_feature_area": "export",
  "suggested_priority": "high",
  "steps": ["Go to dashboard", "Click export button"],
  "expected": "CSV file should download",
  "confidence": 0.95,
  "clarifying_questions": []
}
```

### Categories

- `bug` - Something is broken
- `feature` - Request for new functionality
- `question` - How-to or support query
- `billing` - Payment/subscription issues
- `praise` - Positive feedback
- `other` - Doesn't fit above

### Priority

- `high` → P0 - Blocking/urgent
- `medium` → P1 - Important
- `low` → P2 - Nice to have

### Feature Area

Free-form string detected by AI, e.g.:
- "export", "upload", "dashboard", "billing", "login", "UI", "performance"

## Database Schema

```sql
CREATE TABLE feedback (
  id UUID PRIMARY KEY,
  page_url TEXT NOT NULL,
  user_agent TEXT,
  project_id TEXT,
  message_raw TEXT NOT NULL,
  screenshot_url TEXT,
  ai_data JSONB,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Querying Feedback

```sql
-- Get all bugs by priority
SELECT * FROM feedback
WHERE ai_data->>'suggested_category' = 'bug'
ORDER BY
  CASE ai_data->>'suggested_priority'
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    ELSE 3
  END;

-- Get feedback by feature area
SELECT * FROM feedback
WHERE ai_data->>'suggested_feature_area' = 'export';

-- Count by category
SELECT
  ai_data->>'suggested_category' as category,
  COUNT(*) as count
FROM feedback
GROUP BY ai_data->>'suggested_category';
```

## Security

- **Honeypot field** - Hidden input that bots fill, humans don't
- **Rate limiting** - 10 requests per IP per minute
- **Supabase RLS** - Enable Row Level Security for access control
- **No credentials exposed** - All API keys are server-side only

## Cost

Using Gemini 2.5 Flash Lite:
- ~$0.10 per 1M input tokens
- ~$0.40 per 1M output tokens
- Typical feedback: ~200 tokens = **$0.00002 per feedback**

## Tech Stack

- React 18+
- Next.js 13+ (App Router)
- Supabase (PostgreSQL + Storage)
- Google Gemini 2.5 Flash Lite
- Resend (optional, for emails)

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss changes.

---

Made with ❤️ by [SCAILE Technologies](https://scaile.tech)
