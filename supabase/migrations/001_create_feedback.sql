-- OpenFeedbackLayer Database Schema
-- Run this migration in your Supabase SQL Editor

-- Create feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source information
  page_url TEXT NOT NULL,
  user_agent TEXT,
  project_id TEXT,

  -- User input
  message_raw TEXT NOT NULL,
  screenshot_url TEXT,

  -- AI classification (JSONB for flexibility)
  ai_data JSONB,

  -- Status tracking
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),

  -- Optional: link to your users table
  -- user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_project_id ON feedback(project_id) WHERE project_id IS NOT NULL;

-- AI classification indexes (for filtering by category/priority)
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback((ai_data->>'suggested_category'));
CREATE INDEX IF NOT EXISTS idx_feedback_priority ON feedback((ai_data->>'suggested_priority'));
CREATE INDEX IF NOT EXISTS idx_feedback_feature_area ON feedback((ai_data->>'suggested_feature_area'));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();

-- Row Level Security (optional - enable if you want user-specific access)
-- ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Example RLS policies (uncomment and modify as needed):
--
-- -- Allow anyone to insert (for anonymous feedback)
-- CREATE POLICY "Anyone can insert feedback"
--   ON feedback FOR INSERT
--   WITH CHECK (true);
--
-- -- Only admins can view feedback
-- CREATE POLICY "Admins can view feedback"
--   ON feedback FOR SELECT
--   USING (auth.jwt() ->> 'role' = 'admin');

-- Create storage bucket for screenshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback',
  'feedback',
  true,
  5242880,  -- 5MB max
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: allow public uploads
CREATE POLICY "Allow public uploads to feedback bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'feedback');

-- Storage policy: allow public reads
CREATE POLICY "Allow public reads from feedback bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback');

COMMENT ON TABLE feedback IS 'OpenFeedbackLayer: User feedback with AI classification';
