-- AI assistant (docs/base-de-datos.md §8.32): «Crear con IA» builds a workflow draft from a description.
--   * tenants.ai_assistant_enabled: off by default; an administrator turns it on, accepting that process descriptions go
--     to the AI provider (Ley 1581 transfer notice, audited by the API).
--   * ai_jobs: one row per request. The API inserts fresh PENDING rows (trigger) and reads them; the worker moves them
--     only through the SECURITY DEFINER functions below (lease + claim token + SKIP LOCKED, like the data exports). The
--     description lives in `input` only while the job runs.
--   * ai_usage: every call to the provider and the tokens it cost. Insert-only; the daily limit is computed from it.
-- The FKs take a SHARE ROW EXCLUSIVE lock on tenants and memberships: do not wait behind a long transaction.

SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "ai_task_kind" AS ENUM ('WORKFLOW_DRAFT');

-- CreateEnum
CREATE TYPE "ai_job_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ai_call_outcome" AS ENUM ('OK', 'TOOL_NOT_CALLED', 'INVALID_OUTPUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'ABORTED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "ai_assistant_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_jobs" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "ai_task_kind" NOT NULL,
    "status" "ai_job_status" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "workflow_id" UUID,
    "version_id" UUID,
    "expected_revision" INTEGER,
    "input" JSONB,
    "input_chars" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claim_token" UUID,
    "lease_until" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_kind" "ai_task_kind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "job_attempt" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "cached_prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "reasoning_tokens" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "outcome" "ai_call_outcome" NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE INDEX "ai_jobs_tenant_id_requested_by_id_idx" ON "ai_jobs"("tenant_id", "requested_by_id");

-- CreateIndex
CREATE INDEX "ai_jobs_tenant_id_created_at_idx" ON "ai_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_tenant_id_job_id_idx" ON "ai_usage"("tenant_id", "job_id");

-- CreateIndex
CREATE INDEX "ai_usage_tenant_id_user_id_idx" ON "ai_usage"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "ai_usage_tenant_id_created_at_idx" ON "ai_usage"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_tenant_id_requested_by_id_fkey" FOREIGN KEY ("tenant_id", "requested_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_job_id_fkey" FOREIGN KEY ("tenant_id", "job_id") REFERENCES "ai_jobs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma does not express
-- ---------------------------------------------------------------------------
GRANT UPDATE (ai_assistant_enabled) ON tenants TO app_runtime;

ALTER TABLE ai_jobs
  -- A claim exists exactly while the job runs.
  ADD CONSTRAINT ai_job_claim_coherent CHECK ((status = 'RUNNING') = (claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  -- A finished job has its end time and no longer keeps the description.
  ADD CONSTRAINT ai_job_finished_coherent CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (completed_at IS NOT NULL)),
  ADD CONSTRAINT ai_job_input_only_while_open CHECK (status IN ('PENDING', 'RUNNING') OR input IS NULL),
  ADD CONSTRAINT ai_job_input_object CHECK (input IS NULL OR jsonb_typeof(input) = 'object'),
  ADD CONSTRAINT ai_job_result_object CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  ADD CONSTRAINT ai_job_result_only_succeeded CHECK (result IS NULL OR status = 'SUCCEEDED'),
  -- A workflow draft names the draft and the revision the requester saw.
  ADD CONSTRAINT ai_job_workflow_target CHECK (kind <> 'WORKFLOW_DRAFT' OR (workflow_id IS NOT NULL AND version_id IS NOT NULL AND expected_revision IS NOT NULL)),
  -- Codes only: a message could carry the description.
  ADD CONSTRAINT ai_job_error_code_format CHECK (error_code IS NULL OR error_code ~ '^[A-Z_]{3,64}$'),
  ADD CONSTRAINT ai_job_model_format CHECK (model ~ '^[A-Za-z0-9._:/-]{1,100}$'),
  ADD CONSTRAINT ai_job_numbers_not_negative CHECK (attempts >= 0 AND input_chars >= 0 AND (expected_revision IS NULL OR expected_revision >= 0));

ALTER TABLE ai_usage
  ADD CONSTRAINT ai_usage_tokens_not_negative CHECK (
    prompt_tokens >= 0 AND cached_prompt_tokens >= 0 AND completion_tokens >= 0 AND reasoning_tokens >= 0 AND duration_ms >= 0
    AND job_attempt >= 1 AND round >= 1
  ),
  ADD CONSTRAINT ai_usage_error_code_format CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
  ADD CONSTRAINT ai_usage_names_format CHECK (provider ~ '^[a-z0-9-]{1,40}$' AND model ~ '^[A-Za-z0-9._:/-]{1,100}$');

-- One request at a time per draft (the API answers 409 AI_JOB_IN_PROGRESS on a race).
CREATE UNIQUE INDEX ai_jobs_one_in_flight_per_version ON ai_jobs (tenant_id, version_id) WHERE status IN ('PENDING', 'RUNNING');
-- What the worker claims.
CREATE INDEX ai_jobs_due ON ai_jobs (created_at) WHERE status IN ('PENDING', 'RUNNING');

SELECT app_enable_tenant_rls('ai_jobs');
SELECT app_enable_tenant_rls('ai_usage');

-- The API (and the worker, which inherits app_runtime) inserts requests and reads them; it never updates or deletes
-- them: the worker moves a request through the functions below.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_jobs FROM app_runtime;
-- The ledger is written once per call and never changed: the daily limit and the cost reports read it.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_usage FROM app_runtime;

-- A request starts fresh: PENDING, nothing claimed or produced, dated by the database, asked by the ACTIVE member in
-- context, of an ACTIVE tenant that turned the assistant on.
CREATE FUNCTION ai_job_insert_is_fresh() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.status <> 'PENDING' OR NEW.attempts <> 0 OR NEW.claim_token IS NOT NULL OR NEW.lease_until IS NOT NULL
       OR NEW.error_code IS NOT NULL OR NEW.result IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL
       OR NEW.input IS NULL THEN
      RAISE EXCEPTION 'an AI request starts as a fresh PENDING request with its input' USING ERRCODE = '23514';
    END IF;
    IF NEW.requested_by_id IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'an AI request is made by the member in context' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.requested_by_id AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'only an active member can use the AI assistant' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.tenant_id AND t.status = 'ACTIVE' AND t.ai_assistant_enabled) THEN
      RAISE EXCEPTION 'the organization has not turned the AI assistant on' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION ai_job_insert_is_fresh() FROM PUBLIC;
CREATE TRIGGER ai_job_insert_is_fresh BEFORE INSERT ON ai_jobs
  FOR EACH ROW EXECUTE FUNCTION ai_job_insert_is_fresh();

-- A ledger row is dated by the database (the daily limit counts by date) and belongs to an attempt that was claimed, of a
-- request of the same tenant made by the member it names. The request may have ended meanwhile (its lease expired, or
-- a later attempt finished it) while a paid call was still in flight: that call is recorded all the same.
CREATE FUNCTION ai_usage_insert_is_valid() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM ai_jobs j
      WHERE j.tenant_id = NEW.tenant_id AND j.id = NEW.job_id AND j.status <> 'PENDING'
        AND NEW.job_attempt BETWEEN 1 AND j.attempts
        AND j.requested_by_id = NEW.user_id AND j.kind = NEW.task_kind
    ) THEN
      RAISE EXCEPTION 'a usage row belongs to a claimed attempt of an AI request of its member' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION ai_usage_insert_is_valid() FROM PUBLIC;
CREATE TRIGGER ai_usage_insert_is_valid BEFORE INSERT ON ai_usage
  FOR EACH ROW EXECUTE FUNCTION ai_usage_insert_is_valid();

-- ---------------------------------------------------------------------------
-- The worker protocol (owner app_platform, executable only by app_worker)
-- ---------------------------------------------------------------------------
-- Work is done only for an ACTIVE tenant. A request is attempted at most twice: an attempt is several calls to the
-- provider, each one paid, so a worker that died is retried once and then the request ends LEASE_EXPIRED.
-- Nothing is left open for good (an open request blocks its draft and keeps the description): each claim first ends
--   * a RUNNING request that lost its lease on its second attempt, or whose tenant is no longer ACTIVE (it would never
--     be claimed again): LEASE_EXPIRED;
--   * a request still PENDING 30 minutes after it was made: QUEUE_EXPIRED. A running worker takes one within seconds
--     (or after the one ahead, a few minutes); 30 minutes means no worker is there, and the person waiting on screen
--     has long given up.

CREATE FUNCTION claim_due_ai_jobs(p_limit integer, p_lease interval DEFAULT interval '10 minutes')
  RETURNS TABLE (out_tenant_id uuid, out_job_id uuid, out_claim_token uuid, out_attempt integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_lease IS NULL OR p_lease < interval '1 minute' OR p_lease > interval '30 minutes' THEN
      RAISE EXCEPTION 'the lease must be between 1 minute and 30 minutes' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x
    SET status = 'FAILED', error_code = 'LEASE_EXPIRED', claim_token = NULL, lease_until = NULL, input = NULL, completed_at = now()
    WHERE x.status = 'RUNNING' AND x.lease_until <= now()
      AND (x.attempts >= 2 OR NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = x.tenant_id AND t.status = 'ACTIVE'));
    UPDATE ai_jobs x
    SET status = 'FAILED', error_code = 'QUEUE_EXPIRED', input = NULL, completed_at = now()
    WHERE x.status = 'PENDING' AND x.created_at <= now() - interval '30 minutes';

    RETURN QUERY
    WITH due AS (
      SELECT d.tenant_id, d.id FROM ai_jobs d
      WHERE (d.status = 'PENDING' OR (d.status = 'RUNNING' AND d.lease_until <= now())) AND d.attempts < 2
        AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = d.tenant_id AND t.status = 'ACTIVE')
      ORDER BY d.created_at, d.id
      LIMIT least(greatest(coalesce(p_limit, 1), 1), 10)
      FOR UPDATE OF d SKIP LOCKED
    )
    UPDATE ai_jobs x
    SET status = 'RUNNING', attempts = x.attempts + 1, claim_token = gen_random_uuid(), lease_until = now() + p_lease,
        started_at = coalesce(x.started_at, now())
    FROM due
    WHERE x.tenant_id = due.tenant_id AND x.id = due.id
    RETURNING x.tenant_id, x.id, x.claim_token, x.attempts;
  END
  $$;

-- The heartbeat. false: the claim is not ours any more: stop.
CREATE FUNCTION renew_ai_job_lease(p_tenant uuid, p_id uuid, p_token uuid, p_lease interval DEFAULT interval '10 minutes') RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_lease IS NULL OR p_lease < interval '1 minute' OR p_lease > interval '30 minutes' THEN
      RAISE EXCEPTION 'the lease must be between 1 minute and 30 minutes' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x SET lease_until = now() + p_lease
    FROM tenants t
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token
      AND t.id = x.tenant_id AND t.status = 'ACTIVE';
    RETURN FOUND;
  END
  $$;

-- Done: SUCCEEDED with its result, the description dropped. The worker calls it in the same transaction that writes the
-- draft, so both happen or neither does. false: not ours any more (that transaction must roll back).
CREATE FUNCTION finish_ai_job(p_tenant uuid, p_id uuid, p_token uuid, p_result jsonb) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
      RAISE EXCEPTION 'a finished AI request needs its result object' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x
    SET status = 'SUCCEEDED', claim_token = NULL, lease_until = NULL, error_code = NULL, input = NULL, result = p_result, completed_at = now()
    FROM tenants t
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token
      AND t.id = x.tenant_id AND t.status = 'ACTIVE';
    RETURN FOUND;
  END
  $$;

-- Failed for good (codes only): the description is dropped. A request is not retried after a failure the worker saw:
-- running it again would pay the provider again for the same answer.
CREATE FUNCTION fail_ai_job(p_tenant uuid, p_id uuid, p_token uuid, p_error_code text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_error_code IS NULL THEN
      RAISE EXCEPTION 'a failed AI request needs its error code' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x
    SET status = 'FAILED', claim_token = NULL, lease_until = NULL, input = NULL, error_code = p_error_code, completed_at = now()
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token;
    RETURN FOUND;
  END
  $$;

ALTER FUNCTION claim_due_ai_jobs(integer, interval) OWNER TO app_platform;
ALTER FUNCTION renew_ai_job_lease(uuid, uuid, uuid, interval) OWNER TO app_platform;
ALTER FUNCTION finish_ai_job(uuid, uuid, uuid, jsonb) OWNER TO app_platform;
ALTER FUNCTION fail_ai_job(uuid, uuid, uuid, text) OWNER TO app_platform;

-- Only the worker runs the protocol; app_platform (whose login the API holds) does not, even on the functions it owns.
REVOKE ALL ON FUNCTION
  claim_due_ai_jobs(integer, interval), renew_ai_job_lease(uuid, uuid, uuid, interval),
  finish_ai_job(uuid, uuid, uuid, jsonb), fail_ai_job(uuid, uuid, uuid, text)
  FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION
  claim_due_ai_jobs(integer, interval), renew_ai_job_lease(uuid, uuid, uuid, interval),
  finish_ai_job(uuid, uuid, uuid, jsonb), fail_ai_job(uuid, uuid, uuid, text)
  TO app_worker;
