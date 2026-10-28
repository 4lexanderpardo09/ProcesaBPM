-- A revision, like a new draft, names the draft and the revision the requester saw. Everything else of ai_jobs and
-- ai_usage is kind-agnostic (the insert and ledger triggers, the worker functions, cancel, retention, the realtime
-- signal); the ledger row carries the kind of its request (ai_usage_insert_is_valid compares them).
ALTER TABLE ai_jobs
  DROP CONSTRAINT ai_job_workflow_target,
  ADD CONSTRAINT ai_job_workflow_target CHECK (
    kind NOT IN ('WORKFLOW_DRAFT', 'WORKFLOW_DRAFT_REVISION')
    OR (workflow_id IS NOT NULL AND version_id IS NOT NULL AND expected_revision IS NOT NULL)
  );
