-- Retention of the AI assistant (docs/base-de-datos.md §8.27 and §8.32). The nightly run gains two steps:
--
--   table     | deleted when                                                         | function owner
--   ai_jobs   | SUCCEEDED or FAILED, 90 days after completed_at (PENDING/RUNNING never) | app_retention_owner
--   ai_usage  | 13 months after created_at                                           | app_retention_owner
--
-- The ledger outlives its request: the foreign key ai_usage -> ai_jobs (ON DELETE CASCADE) would delete 13-month ledger
-- rows together with a 90-day request, so it goes. ai_usage_insert_is_valid still checks, at insert, that the request
-- exists, belongs to the same tenant and member, and is RUNNING; the ledger is insert-only, so that holds for good.
--
-- Both tables are written only by the API (insert) and the worker functions, and nothing else may delete them: the purge
-- runs as app_retention_owner (NOLOGIN, without BYPASSRLS), whose policies only show it rows past the window. No FOR
-- UPDATE: it would need UPDATE, and a finished request or a ledger row is never changed again.
--
-- Production note: on large tables create the indexes below beforehand with CREATE INDEX CONCURRENTLY and the same names
-- (docs/despliegue.md §5). The statements that take a table's exclusive lock (the dropped foreign key, the policies) come last.

SET LOCAL lock_timeout = '10s';

-- ===========================================================================
-- 1. Indexes for the cross-tenant scans (the existing ones start with tenant_id)
-- ===========================================================================
CREATE INDEX IF NOT EXISTS ai_jobs_completed_at_idx ON ai_jobs (completed_at);
CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON ai_usage (created_at);

-- ===========================================================================
-- 2. Functions (same contract as the other retention_purge_*: one batch, oldest first, 0 when another call holds the table)
-- ===========================================================================
CREATE FUNCTION retention_purge_ai_jobs(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:ai_jobs')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT tenant_id, id FROM ai_jobs
      WHERE status IN ('SUCCEEDED', 'FAILED') AND completed_at < now() - interval '90 days'
      ORDER BY completed_at LIMIT retention_batch_limit(p_limit)
    ), deleted AS (
      DELETE FROM ai_jobs j USING victims v WHERE j.tenant_id = v.tenant_id AND j.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

CREATE FUNCTION retention_purge_ai_usage(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:ai_usage')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT tenant_id, id FROM ai_usage
      WHERE created_at < now() - interval '13 months'
      ORDER BY created_at LIMIT retention_batch_limit(p_limit)
    ), deleted AS (
      DELETE FROM ai_usage u USING victims v WHERE u.tenant_id = v.tenant_id AND u.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

-- The run summary accepts the two new steps. Same signature: the owner (app_platform) and the grants are kept.
CREATE OR REPLACE FUNCTION retention_finish_run(p_run_id uuid, p_deleted jsonb, p_failed text[], p_duration_ms integer, p_interrupted boolean)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_steps CONSTANT text[] := ARRAY[
      'outbox_events', 'platform_outbox_events', 'notifications', 'refresh_sessions', 'user_tokens', 'ai_jobs', 'ai_usage',
      'audit_logs', 'support_sessions', 'support_access_grants', 'platform_audit_logs', 'expire_tenant_exports'
    ];
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_audit_logs WHERE id = p_run_id AND action = 'retention.run_started') THEN
      RAISE EXCEPTION 'unknown retention run' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM platform_audit_logs WHERE action = 'retention.run_finished' AND data ->> 'runId' = p_run_id::text) THEN
      RAISE EXCEPTION 'retention run already finished' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_deleted) IS DISTINCT FROM 'object' OR p_duration_ms IS NULL OR p_duration_ms < 0
       OR NOT (coalesce(p_failed, '{}') <@ v_steps) OR p_interrupted IS NULL THEN
      RAISE EXCEPTION 'invalid retention run summary' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each(p_deleted) e
      WHERE NOT (e.key = ANY (v_steps))
         OR CASE WHEN jsonb_typeof(e.value) = 'number'
                 THEN (e.value)::numeric < 0 OR (e.value)::numeric <> trunc((e.value)::numeric)
                 ELSE true END
    ) THEN
      RAISE EXCEPTION 'invalid retention run summary' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform_audit_logs (actor_user_id, action, data)
    VALUES (NULL, 'retention.run_finished', jsonb_build_object(
      'runId', p_run_id, 'deleted', p_deleted, 'failed', to_jsonb(coalesce(p_failed, '{}')), 'durationMs', p_duration_ms,
      'interrupted', p_interrupted));
  END
  $$;

ALTER FUNCTION retention_purge_ai_jobs(integer) OWNER TO app_retention_owner;
ALTER FUNCTION retention_purge_ai_usage(integer) OWNER TO app_retention_owner;

-- Only the worker runs retention.
REVOKE ALL ON FUNCTION retention_purge_ai_jobs(integer), retention_purge_ai_usage(integer) FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION retention_purge_ai_jobs(integer), retention_purge_ai_usage(integer) TO app_worker;

-- ===========================================================================
-- 3. app_retention_owner: DELETE plus the columns its WHERE clauses read, and only rows past the window
-- ===========================================================================
GRANT SELECT (tenant_id, id, status, completed_at), DELETE ON ai_jobs TO app_retention_owner;
GRANT SELECT (tenant_id, id, created_at), DELETE ON ai_usage TO app_retention_owner;

-- ===========================================================================
-- 4. Exclusive locks last: the ledger no longer depends on its request, and the purge owner's policies
-- ===========================================================================
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_tenant_id_job_id_fkey;

CREATE POLICY retention_window ON ai_jobs FOR ALL TO app_retention_owner
  USING (status IN ('SUCCEEDED', 'FAILED') AND completed_at < now() - interval '90 days');
CREATE POLICY retention_window_only ON ai_jobs AS RESTRICTIVE FOR ALL TO app_retention_owner
  USING (status IN ('SUCCEEDED', 'FAILED') AND completed_at < now() - interval '90 days');

CREATE POLICY retention_window ON ai_usage FOR ALL TO app_retention_owner
  USING (created_at < now() - interval '13 months');
CREATE POLICY retention_window_only ON ai_usage AS RESTRICTIVE FOR ALL TO app_retention_owner
  USING (created_at < now() - interval '13 months');
