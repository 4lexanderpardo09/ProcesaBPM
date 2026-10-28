-- «Crear con IA» as a live panel (docs/base-de-datos.md §8.32, docs/arquitectura.md §22):
--   * progress: ai_jobs.stage/round/problems, written by the worker through set_ai_job_stage (the API role cannot
--     UPDATE ai_jobs), so a reload shows where a request is;
--   * cancel: cancel_ai_job, run by the API for the member in context; the request ends FAILED with error_code
--     CANCELLED and cancelled_by_id, and the worker's next lease renewal or stage update answers false, so it stops
--     without recording a result. Calls already paid stay in the ledger;
--   * history: the description is kept after the request ends (decided by the user, 2026-10-28), visible only inside
--     the organization, and leaves with the request when retention deletes it (90 days after completed_at);
--   * realtime: every new request and every change of status or progress sends an id-only signal (like §8.25).
-- The new foreign key takes a SHARE ROW EXCLUSIVE lock on memberships: do not wait behind a long transaction.

SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "ai_job_stage" AS ENUM ('READING', 'DESIGNING', 'REVIEWING', 'WRITING');

-- AlterTable
ALTER TABLE "ai_jobs" ADD COLUMN     "cancelled_by_id" UUID,
ADD COLUMN     "problems" INTEGER,
ADD COLUMN     "round" INTEGER,
ADD COLUMN     "stage" "ai_job_stage";

-- CreateIndex
CREATE INDEX "ai_jobs_tenant_id_cancelled_by_id_idx" ON "ai_jobs"("tenant_id", "cancelled_by_id");

-- CreateIndex
CREATE INDEX "ai_jobs_tenant_id_version_id_created_at_idx" ON "ai_jobs"("tenant_id", "version_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_tenant_id_cancelled_by_id_fkey" FOREIGN KEY ("tenant_id", "cancelled_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma does not express
-- ---------------------------------------------------------------------------
ALTER TABLE ai_jobs
  -- The description is history now: it stays until retention deletes the request.
  DROP CONSTRAINT ai_job_input_only_while_open,
  -- A PENDING request has no progress; the numbers belong to a stage; DESIGNING and REVIEWING name their round, and
  -- REVIEWING the problems it found.
  ADD CONSTRAINT ai_job_progress_coherent CHECK (
    (status <> 'PENDING' OR (stage IS NULL AND round IS NULL AND problems IS NULL))
    AND (stage IS NOT NULL OR (round IS NULL AND problems IS NULL))
    AND (stage IS NULL OR stage NOT IN ('DESIGNING', 'REVIEWING') OR round IS NOT NULL)
    AND (stage IS NULL OR stage <> 'REVIEWING' OR problems IS NOT NULL)
    AND (round IS NULL OR round BETWEEN 1 AND 20)
    AND (problems IS NULL OR problems >= 0)
  ),
  -- CANCELLED is the cancel function's alone, and always says who.
  ADD CONSTRAINT ai_job_cancelled_coherent CHECK ((cancelled_by_id IS NOT NULL) = coalesce(error_code = 'CANCELLED', false));

-- A request starts fresh: also without progress and not cancelled. Same rules otherwise (20261029000000_ai_assistant).
CREATE OR REPLACE FUNCTION ai_job_insert_is_fresh() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.status <> 'PENDING' OR NEW.attempts <> 0 OR NEW.claim_token IS NOT NULL OR NEW.lease_until IS NOT NULL
       OR NEW.error_code IS NOT NULL OR NEW.result IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL
       OR NEW.stage IS NOT NULL OR NEW.round IS NOT NULL OR NEW.problems IS NOT NULL OR NEW.cancelled_by_id IS NOT NULL
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

-- ---------------------------------------------------------------------------
-- The worker protocol, again: the description is no longer dropped, and a claim starts at READING
-- (CREATE OR REPLACE keeps the owner app_platform and the grants: executable only by app_worker)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_ai_jobs(p_limit integer, p_lease interval DEFAULT interval '10 minutes')
  RETURNS TABLE (out_tenant_id uuid, out_job_id uuid, out_claim_token uuid, out_attempt integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_lease IS NULL OR p_lease < interval '1 minute' OR p_lease > interval '30 minutes' THEN
      RAISE EXCEPTION 'the lease must be between 1 minute and 30 minutes' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x
    SET status = 'FAILED', error_code = 'LEASE_EXPIRED', claim_token = NULL, lease_until = NULL, completed_at = now()
    WHERE x.status = 'RUNNING' AND x.lease_until <= now()
      AND (x.attempts >= 2 OR NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = x.tenant_id AND t.status = 'ACTIVE'));
    UPDATE ai_jobs x
    SET status = 'FAILED', error_code = 'QUEUE_EXPIRED', completed_at = now()
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
        started_at = coalesce(x.started_at, now()), stage = 'READING', round = NULL, problems = NULL
    FROM due
    WHERE x.tenant_id = due.tenant_id AND x.id = due.id
    RETURNING x.tenant_id, x.id, x.claim_token, x.attempts;
  END
  $$;

-- Done: SUCCEEDED with its result. The worker calls it in the same transaction that writes the draft. false: not ours
-- any more (cancelled, or the lease went to another attempt): that transaction must roll back.
CREATE OR REPLACE FUNCTION finish_ai_job(p_tenant uuid, p_id uuid, p_token uuid, p_result jsonb) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
      RAISE EXCEPTION 'a finished AI request needs its result object' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x
    SET status = 'SUCCEEDED', claim_token = NULL, lease_until = NULL, error_code = NULL, result = p_result, completed_at = now()
    FROM tenants t
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token
      AND t.id = x.tenant_id AND t.status = 'ACTIVE';
    RETURN FOUND;
  END
  $$;

-- Failed for good (codes only). CANCELLED is not the worker's to say.
CREATE OR REPLACE FUNCTION fail_ai_job(p_tenant uuid, p_id uuid, p_token uuid, p_error_code text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_error_code IS NULL OR p_error_code = 'CANCELLED' THEN
      RAISE EXCEPTION 'a failed AI request needs its own error code' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x
    SET status = 'FAILED', claim_token = NULL, lease_until = NULL, error_code = p_error_code, completed_at = now()
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token;
    RETURN FOUND;
  END
  $$;

-- Progress: what the claimed attempt is doing now. false: not ours any more (cancelled, expired, tenant no longer
-- ACTIVE): stop, like a refused lease renewal.
CREATE FUNCTION set_ai_job_stage(p_tenant uuid, p_id uuid, p_token uuid, p_stage ai_job_stage, p_round integer, p_problems integer)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_stage IS NULL
       OR (p_round IS NOT NULL AND (p_round < 1 OR p_round > 20))
       OR (p_problems IS NOT NULL AND p_problems < 0)
       OR (p_stage = 'READING' AND (p_round IS NOT NULL OR p_problems IS NOT NULL))
       OR (p_stage IN ('DESIGNING', 'WRITING') AND p_problems IS NOT NULL)
       OR (p_stage IN ('DESIGNING', 'REVIEWING') AND p_round IS NULL)
       OR (p_stage = 'REVIEWING' AND p_problems IS NULL) THEN
      RAISE EXCEPTION 'invalid AI request progress' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x SET stage = p_stage, round = p_round, problems = p_problems
    FROM tenants t
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token
      AND t.id = x.tenant_id AND t.status = 'ACTIVE';
    RETURN FOUND;
  END
  $$;

ALTER FUNCTION set_ai_job_stage(uuid, uuid, uuid, ai_job_stage, integer, integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION set_ai_job_stage(uuid, uuid, uuid, ai_job_stage, integer, integer) FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION set_ai_job_stage(uuid, uuid, uuid, ai_job_stage, integer, integer) TO app_worker;

-- ---------------------------------------------------------------------------
-- Cancel (the API, for the member in context)
-- ---------------------------------------------------------------------------
-- The API decides who may cancel (update Workflow); this function only acts inside the tenant in context, for an
-- ACTIVE member of it, on a request still open. It runs as app_platform (BYPASSRLS): every statement names the
-- tenant in context. true: cancelled now; false: no such request in this tenant, or it had already ended.
CREATE FUNCTION cancel_ai_job(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := app_current_tenant();
    v_user uuid := app_current_user();
  BEGIN
    IF v_tenant IS NULL OR v_user IS NULL THEN
      RAISE EXCEPTION 'cancelling an AI request needs the tenant and the member in context' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = v_tenant AND m.user_id = v_user AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'only an active member can cancel an AI request' USING ERRCODE = '42501';
    END IF;
    UPDATE ai_jobs x
    SET status = 'FAILED', error_code = 'CANCELLED', cancelled_by_id = v_user, claim_token = NULL, lease_until = NULL, completed_at = now()
    WHERE x.tenant_id = v_tenant AND x.id = p_id AND x.status IN ('PENDING', 'RUNNING');
    RETURN FOUND;
  END
  $$;

ALTER FUNCTION cancel_ai_job(uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION cancel_ai_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_ai_job(uuid) TO app_runtime;

-- ---------------------------------------------------------------------------
-- Realtime: an id-only hint to the API instances (docs/arquitectura.md §18). The tenant and the draft only locate the
-- sockets; whoever receives it re-checks the session and the permission, and reads the request with RLS.
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_realtime_ai_job_signal() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.version_id IS NOT NULL THEN
      PERFORM pg_notify('procesabpm_realtime', jsonb_build_object('v', 1, 'k', 'ai_job', 't', NEW.tenant_id, 'id', NEW.id, 'w', NEW.version_id)::text);
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION trg_realtime_ai_job_signal() FROM PUBLIC;

CREATE TRIGGER realtime_ai_job_created AFTER INSERT ON ai_jobs FOR EACH ROW EXECUTE FUNCTION trg_realtime_ai_job_signal();
CREATE TRIGGER realtime_ai_job_changed AFTER UPDATE OF status, stage, round, problems ON ai_jobs FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.stage IS DISTINCT FROM NEW.stage OR OLD.round IS DISTINCT FROM NEW.round
     OR OLD.problems IS DISTINCT FROM NEW.problems)
  EXECUTE FUNCTION trg_realtime_ai_job_signal();
