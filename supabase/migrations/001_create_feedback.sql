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

  -- Optional feedback journey and GitHub issue tracking
  submitter_email TEXT,
  subscribe BOOLEAN DEFAULT false NOT NULL,
  github_issue_number INTEGER,
  github_issue_url TEXT,
  github_repo TEXT,
  journey_stage TEXT DEFAULT 'received' NOT NULL
    CHECK (journey_stage IN ('received','triaged','in_progress','shipped','wont_fix')),
  last_emailed_stage TEXT,

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_repo_issue
  ON feedback(github_repo, github_issue_number)
  WHERE github_issue_number IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feedback_updated_at ON feedback;
CREATE TRIGGER feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();

-- Lock the table down by default. OpenFeedbackLayer's bundled route handlers
-- write with SUPABASE_SERVICE_ROLE_KEY server-side; browsers never need direct
-- PostgREST access to the feedback table. Hosts that intentionally build an
-- admin UI can add their own read policies after applying this migration.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE feedback FROM anon;
REVOKE ALL ON TABLE feedback FROM authenticated;
REVOKE ALL ON FUNCTION update_feedback_updated_at() FROM PUBLIC;

COMMENT ON TABLE feedback IS 'OpenFeedbackLayer: User feedback with AI classification';

-- Screenshot storage (Supabase Storage bucket + policies) is OPTIONAL and lives
-- in 003_screenshot_storage.sql so this core schema applies on any Postgres.
