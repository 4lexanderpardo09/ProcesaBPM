-- «Crear con IA» draws the diagram while the model writes it (docs/base-de-datos.md §8.32, docs/arquitectura.md §22):
--   * ai_jobs.preview: the blocks and connections of the round in DESIGNING that the model has finished writing so far
--     ({"steps": [{ref, type, name}], "transitions": [{from, to, label}]}), written by the worker through
--     set_ai_job_preview (the API role cannot UPDATE ai_jobs);
--   * it lives only while the request runs: a new attempt, a new stage or round, and the end of the request clear it
--     (a trigger, so claim, finish, fail, cancel and the expirations need no change);
--   * realtime: a new preview sends the same id-only signal as progress.
-- Same privacy as the description (names come from it): visible only inside the organization, never logged.

SET LOCAL lock_timeout = '10s';

-- AlterTable
ALTER TABLE "ai_jobs" ADD COLUMN     "preview" JSONB;

-- ---------------------------------------------------------------------------
-- Rules Prisma does not express
-- ---------------------------------------------------------------------------
ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_job_preview_while_designing CHECK (preview IS NULL OR (status = 'RUNNING' AND stage = 'DESIGNING')),
  ADD CONSTRAINT ai_job_preview_bounded CHECK (preview IS NULL OR (jsonb_typeof(preview) = 'object' AND octet_length(preview::text) <= 65536));

-- A request starts fresh: also without a preview. Same rules otherwise (20261029000200_ai_job_progress).
CREATE OR REPLACE FUNCTION ai_job_insert_is_fresh() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.status <> 'PENDING' OR NEW.attempts <> 0 OR NEW.claim_token IS NOT NULL OR NEW.lease_until IS NOT NULL
       OR NEW.error_code IS NOT NULL OR NEW.result IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL
       OR NEW.stage IS NOT NULL OR NEW.round IS NOT NULL OR NEW.problems IS NOT NULL OR NEW.cancelled_by_id IS NOT NULL
       OR NEW.preview IS NOT NULL OR NEW.input IS NULL THEN
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

-- The preview belongs to one attempt, one round of DESIGNING and an open request: anything else clears it, so no
-- function that ends, reclaims or moves a request has to remember it.
CREATE FUNCTION ai_job_preview_follows_progress() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.status <> 'RUNNING' OR NEW.stage IS DISTINCT FROM 'DESIGNING' OR NEW.claim_token IS DISTINCT FROM OLD.claim_token
       OR NEW.round IS DISTINCT FROM OLD.round OR NEW.stage IS DISTINCT FROM OLD.stage THEN
      NEW.preview := NULL;
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION ai_job_preview_follows_progress() FROM PUBLIC;

CREATE TRIGGER ai_job_preview_follows_progress BEFORE UPDATE ON ai_jobs FOR EACH ROW EXECUTE FUNCTION ai_job_preview_follows_progress();

-- What the model has written so far in round p_round. false: not ours any more, or no longer that round of
-- DESIGNING (a late write after the answer arrived): the worker just goes on.
CREATE FUNCTION set_ai_job_preview(p_tenant uuid, p_id uuid, p_token uuid, p_round integer, p_preview jsonb) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_round IS NULL OR p_round < 1 OR p_round > 20
       OR p_preview IS NULL OR jsonb_typeof(p_preview) <> 'object'
       OR jsonb_typeof(p_preview -> 'steps') IS DISTINCT FROM 'array' OR jsonb_typeof(p_preview -> 'transitions') IS DISTINCT FROM 'array'
       OR octet_length(p_preview::text) > 65536 THEN
      RAISE EXCEPTION 'invalid AI request preview' USING ERRCODE = '22023';
    END IF;
    UPDATE ai_jobs x SET preview = p_preview
    FROM tenants t
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token
      AND x.stage = 'DESIGNING' AND x.round = p_round
      AND t.id = x.tenant_id AND t.status = 'ACTIVE';
    RETURN FOUND;
  END
  $$;

ALTER FUNCTION set_ai_job_preview(uuid, uuid, uuid, integer, jsonb) OWNER TO app_platform;
REVOKE ALL ON FUNCTION set_ai_job_preview(uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION set_ai_job_preview(uuid, uuid, uuid, integer, jsonb) TO app_worker;

-- Realtime: a new preview is progress too (20261029000200_ai_job_progress).
DROP TRIGGER realtime_ai_job_changed ON ai_jobs;
CREATE TRIGGER realtime_ai_job_changed AFTER UPDATE OF status, stage, round, problems, preview ON ai_jobs FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.stage IS DISTINCT FROM NEW.stage OR OLD.round IS DISTINCT FROM NEW.round
     OR OLD.problems IS DISTINCT FROM NEW.problems OR OLD.preview IS DISTINCT FROM NEW.preview)
  EXECUTE FUNCTION trg_realtime_ai_job_signal();
