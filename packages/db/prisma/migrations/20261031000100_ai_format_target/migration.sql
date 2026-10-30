-- A format request names its workflow and its format (no foreign key, as with the draft: deleting the format must not
-- delete the request and its cost; the worker then fails it with FORMAT_GONE). It writes nothing but its result: the
-- design goes back to the designer, and the person saves it. Everything else of ai_jobs and ai_usage is kind-agnostic.
ALTER TABLE ai_jobs ADD COLUMN format_id UUID;

ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_job_format_target CHECK (
    kind NOT IN ('PDF_FORMAT_DRAFT', 'PDF_FORMAT_REVISION')
    OR (workflow_id IS NOT NULL AND format_id IS NOT NULL AND version_id IS NULL)
  );

-- One request at a time per format (the API answers 409 AI_JOB_IN_PROGRESS on a race), as per draft.
CREATE UNIQUE INDEX ai_jobs_one_in_flight_per_format ON ai_jobs (tenant_id, format_id) WHERE status IN ('PENDING', 'RUNNING') AND format_id IS NOT NULL;

-- The history of a format in its designer.
CREATE INDEX "ai_jobs_tenant_id_format_id_created_at_idx" ON "ai_jobs"("tenant_id", "format_id", "created_at");
