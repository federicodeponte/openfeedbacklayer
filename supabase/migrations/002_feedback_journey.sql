-- OpenFeedbackLayer Feedback Journey
-- Adds optional submitter updates and GitHub issue tracking.

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS submitter_email TEXT,
  ADD COLUMN IF NOT EXISTS subscribe BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS github_issue_number INTEGER,
  ADD COLUMN IF NOT EXISTS github_issue_url TEXT,
  ADD COLUMN IF NOT EXISTS github_repo TEXT,
  ADD COLUMN IF NOT EXISTS journey_stage TEXT DEFAULT 'received' NOT NULL
    CHECK (journey_stage IN ('received','triaged','in_progress','shipped','wont_fix')),
  ADD COLUMN IF NOT EXISTS last_emailed_stage TEXT;

DROP INDEX IF EXISTS idx_feedback_issue_number;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_repo_issue
  ON feedback(github_repo, github_issue_number)
  WHERE github_issue_number IS NOT NULL;

COMMENT ON COLUMN feedback.journey_stage IS 'OpenFeedbackLayer feedback journey stage for GitHub issue and subscriber update flow';
