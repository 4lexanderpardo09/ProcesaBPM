-- The retention run gains the step that expires organization data exports (docs/base-de-datos.md §8.27 and §8.31):
-- retention_finish_run accepts its name in the run summary. Same signature, so the owner (app_platform) and the grants
-- (EXECUTE only for app_worker) are kept. No table is touched.

CREATE OR REPLACE FUNCTION retention_finish_run(p_run_id uuid, p_deleted jsonb, p_failed text[], p_duration_ms integer, p_interrupted boolean)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_steps CONSTANT text[] := ARRAY[
      'outbox_events', 'platform_outbox_events', 'notifications', 'refresh_sessions', 'user_tokens',
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
