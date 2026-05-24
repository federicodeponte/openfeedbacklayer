-- OpenFeedbackLayer: atomic, forward-only stage-claim for the webhook journey.
--
-- The webhook must advance journey_stage forward-only and emit exactly one
-- subscriber email per stage even under concurrent / duplicate / out-of-order
-- GitHub deliveries. A check-then-write in application code races; a PostgREST
-- `or` filter on a mutation is rejected (SQLSTATE 42703). This function does
-- the whole decision in one atomic statement:
--   * last_emailed_stage IS DISTINCT FROM p_stage  -> not already emailed
--     (NULL-safe: a never-emailed row is claimable)
--   * rank(p_stage) > rank(current journey_stage)   -> strictly forward only,
--     so a late 'triaged' cannot regress a row already at 'shipped'
-- It returns the row id only to the caller that won the claim; concurrent or
-- duplicate or backward deliveries get zero rows and send no email.

CREATE OR REPLACE FUNCTION ofl_stage_rank(p_stage text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'received'    THEN 0
    WHEN 'triaged'     THEN 1
    WHEN 'in_progress' THEN 2
    WHEN 'shipped'     THEN 3
    WHEN 'wont_fix'    THEN 3
    ELSE -1
  END;
$$;

CREATE OR REPLACE FUNCTION claim_feedback_stage(p_id uuid, p_stage text)
RETURNS TABLE (id uuid)
LANGUAGE sql
AS $$
  UPDATE feedback
     SET journey_stage = p_stage,
         last_emailed_stage = p_stage
   WHERE feedback.id = p_id
     AND feedback.last_emailed_stage IS DISTINCT FROM p_stage
     AND ofl_stage_rank(p_stage)
         > ofl_stage_rank(COALESCE(feedback.journey_stage, 'received'))
  RETURNING feedback.id;
$$;

COMMENT ON FUNCTION claim_feedback_stage(uuid, text) IS
  'OpenFeedbackLayer: atomic forward-only claim of a feedback journey stage; returns id only to the winning caller.';

-- Server-only. Supabase grants EXECUTE on new functions to PUBLIC (which
-- includes anon and authenticated) by default; revoke that and grant only the
-- service_role used by the server-side webhook handler, so the public REST
-- API cannot drive journey state.
REVOKE EXECUTE ON FUNCTION ofl_stage_rank(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_feedback_stage(uuid, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ofl_stage_rank(text) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION claim_feedback_stage(uuid, text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ofl_stage_rank(text) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION claim_feedback_stage(uuid, text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION claim_feedback_stage(uuid, text) TO service_role';
  END IF;
END $$;
