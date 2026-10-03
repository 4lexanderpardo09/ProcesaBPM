-- Retention of the tables that grow forever (docs/base-de-datos.md §8.27). The worker runs it once a night through
-- functions only app_worker may execute; every window is a constant in this file (no caller can shorten it, changing
-- one is a migration):
--
--   table                       | deleted when                                                    | function owner
--   outbox_events               | DONE 7 days after processed_at; FAILED 30 days after created_at | app_platform
--   platform_outbox_events      | same                                                            | app_outbox_owner
--   notifications               | read 180 days after read_at; unread 365 days after created_at  | app_platform
--   refresh_sessions            | 30 days after expires_at                                        | app_platform
--   user_tokens                 | 30 days after expires_at                                        | app_platform
--   audit_logs                  | 2 years after created_at                                        | app_retention_owner
--   support_sessions            | 2 years after opened_at                                         | app_retention_owner
--   support_access_grants       | 2 years and 1 day after expires_at, once nothing references it  | app_retention_owner
--   platform_audit_logs         | 5 years after created_at                                        | app_retention_owner
--
-- The trails are append-only for every login (no DELETE, not even for app_platform). Their purge runs as a new NOLOGIN
-- role, app_retention_owner, without BYPASSRLS, without INSERT or UPDATE anywhere, whose row-level security policies only
-- show it rows past the window: even a bug in a function body (or a DELETE with an explicit id) cannot remove a younger
-- row. A restrictive policy keeps the tenant_isolation policy (which applies to every role) from widening that.
--
-- Production note: on large tables create the indexes below beforehand with CREATE INDEX CONCURRENTLY and the same names;
-- IF NOT EXISTS then skips them here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_retention_owner') THEN
    CREATE ROLE app_retention_owner NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO app_retention_owner;

-- ===========================================================================
-- 1. Run bookkeeping: retention rows of the platform trail have no human actor
-- ===========================================================================
ALTER TABLE platform_audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD CONSTRAINT platform_audit_actor_required CHECK (actor_user_id IS NOT NULL OR action LIKE 'retention.%');

-- ===========================================================================
-- 2. Indexes for the cross-tenant scans (the existing ones start with tenant_id)
-- ===========================================================================
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS platform_audit_logs_created_at_idx ON platform_audit_logs (created_at);
CREATE INDEX IF NOT EXISTS refresh_sessions_expires_at_idx ON refresh_sessions (expires_at);
CREATE INDEX IF NOT EXISTS user_tokens_expires_at_idx ON user_tokens (expires_at);
CREATE INDEX IF NOT EXISTS outbox_events_done_processed_at ON outbox_events (processed_at) WHERE status = 'DONE';
CREATE INDEX IF NOT EXISTS outbox_events_failed_created_at ON outbox_events (created_at) WHERE status = 'FAILED';
CREATE INDEX IF NOT EXISTS platform_outbox_events_done_processed_at ON platform_outbox_events (processed_at) WHERE status = 'DONE';
CREATE INDEX IF NOT EXISTS platform_outbox_events_failed_created_at ON platform_outbox_events (created_at) WHERE status = 'FAILED';
CREATE INDEX IF NOT EXISTS notifications_read_at ON notifications (read_at) WHERE read_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_unread_created_at ON notifications (created_at) WHERE read_at IS NULL;

-- ===========================================================================
-- 3. app_retention_owner: DELETE plus the columns its WHERE clauses read, and only rows past the window
-- ===========================================================================
GRANT SELECT (tenant_id, id, created_at, support_grant_id), DELETE ON audit_logs TO app_retention_owner;
GRANT SELECT (id, created_at), DELETE ON platform_audit_logs TO app_retention_owner;
GRANT SELECT (tenant_id, id, grant_id, opened_at), DELETE ON support_sessions TO app_retention_owner;
GRANT SELECT (tenant_id, id, expires_at), DELETE ON support_access_grants TO app_retention_owner;

CREATE POLICY retention_window ON audit_logs FOR ALL TO app_retention_owner
  USING (created_at < now() - interval '2 years');
CREATE POLICY retention_window_only ON audit_logs AS RESTRICTIVE FOR ALL TO app_retention_owner
  USING (created_at < now() - interval '2 years');

CREATE POLICY retention_window ON support_sessions FOR ALL TO app_retention_owner
  USING (opened_at < now() - interval '2 years');
CREATE POLICY retention_window_only ON support_sessions AS RESTRICTIVE FOR ALL TO app_retention_owner
  USING (opened_at < now() - interval '2 years');

-- A grant ends at expires_at at the latest (a visit cannot outlive it), so its sessions and audit rows are older than
-- that; the extra day covers a request that was verified just before the expiry and audited just after it.
CREATE POLICY retention_window ON support_access_grants FOR ALL TO app_retention_owner
  USING (expires_at < now() - interval '2 years 1 day');
CREATE POLICY retention_window_only ON support_access_grants AS RESTRICTIVE FOR ALL TO app_retention_owner
  USING (expires_at < now() - interval '2 years 1 day');

-- The platform trail had no row-level security: app_platform bypasses it (BYPASSRLS), app_runtime and app_worker have no
-- privilege on the table and its owner is not subject to it (not forced), so only app_retention_owner is affected.
ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY retention_window ON platform_audit_logs FOR ALL TO app_retention_owner
  USING (created_at < now() - interval '5 years');
CREATE POLICY retention_window_only ON platform_audit_logs AS RESTRICTIVE FOR ALL TO app_retention_owner
  USING (created_at < now() - interval '5 years');

-- ===========================================================================
-- 4. Functions. Each call deletes at most one batch (1..10 000 rows, oldest first) and returns how many it deleted; the
--    worker calls again until a batch comes back short. A concurrent call on the same table returns 0 at once.
-- ===========================================================================
CREATE FUNCTION retention_batch_limit(p_limit integer) RETURNS integer
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
  AS $$ SELECT least(greatest(coalesce(p_limit, 1), 1), 10000) $$;

-- 4.1 Tenant outbox (app_platform: it sees every tenant). SKIP LOCKED: a row a console retry is touching waits for the next batch.
CREATE FUNCTION retention_purge_outbox_events(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_limit integer := retention_batch_limit(p_limit);
    v_done integer;
    v_failed integer := 0;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:outbox_events')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT tenant_id, id FROM outbox_events
      WHERE status = 'DONE' AND processed_at < now() - interval '7 days'
      ORDER BY processed_at LIMIT v_limit FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM outbox_events e USING victims v WHERE e.tenant_id = v.tenant_id AND e.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_done FROM deleted;
    IF v_done < v_limit THEN
      WITH victims AS (
        SELECT tenant_id, id FROM outbox_events
        WHERE status = 'FAILED' AND created_at < now() - interval '30 days'
        ORDER BY created_at LIMIT v_limit - v_done FOR UPDATE SKIP LOCKED
      ), deleted AS (
        DELETE FROM outbox_events e USING victims v WHERE e.tenant_id = v.tenant_id AND e.id = v.id RETURNING 1
      )
      SELECT count(*) INTO v_failed FROM deleted;
    END IF;
    RETURN v_done + v_failed;
  END
  $$;

-- 4.2 Platform outbox (app_outbox_owner: nobody else may read that table). PENDING and PROCESSING events stay whatever their age.
CREATE FUNCTION retention_purge_platform_outbox_events(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_limit integer := retention_batch_limit(p_limit);
    v_done integer;
    v_failed integer := 0;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:platform_outbox_events')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT id FROM platform_outbox_events
      WHERE status = 'DONE' AND processed_at < now() - interval '7 days'
      ORDER BY processed_at LIMIT v_limit FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM platform_outbox_events e USING victims v WHERE e.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_done FROM deleted;
    IF v_done < v_limit THEN
      WITH victims AS (
        SELECT id FROM platform_outbox_events
        WHERE status = 'FAILED' AND created_at < now() - interval '30 days'
        ORDER BY created_at LIMIT v_limit - v_done FOR UPDATE SKIP LOCKED
      ), deleted AS (
        DELETE FROM platform_outbox_events e USING victims v WHERE e.id = v.id RETURNING 1
      )
      SELECT count(*) INTO v_failed FROM deleted;
    END IF;
    RETURN v_done + v_failed;
  END
  $$;

-- 4.3 In-app notifications: unread ones a year after they were created, read ones 180 days after they were read.
CREATE FUNCTION retention_purge_notifications(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_limit integer := retention_batch_limit(p_limit);
    v_unread integer;
    v_read integer := 0;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:notifications')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT tenant_id, id FROM notifications
      WHERE read_at IS NULL AND created_at < now() - interval '365 days'
      ORDER BY created_at LIMIT v_limit FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM notifications n USING victims v WHERE n.tenant_id = v.tenant_id AND n.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_unread FROM deleted;
    IF v_unread < v_limit THEN
      WITH victims AS (
        SELECT tenant_id, id FROM notifications
        WHERE read_at IS NOT NULL AND read_at < now() - interval '180 days'
        ORDER BY read_at LIMIT v_limit - v_unread FOR UPDATE SKIP LOCKED
      ), deleted AS (
        DELETE FROM notifications n USING victims v WHERE n.tenant_id = v.tenant_id AND n.id = v.id RETURNING 1
      )
      SELECT count(*) INTO v_read FROM deleted;
    END IF;
    RETURN v_unread + v_read;
  END
  $$;

-- 4.4 Refresh sessions, 30 days after they expired (rotation keeps the expiry, so a revoked or rotated row is gone at
-- most 30 days after its whole family stopped working; the IP and agent stay that long for incident analysis).
CREATE FUNCTION retention_purge_refresh_sessions(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:refresh_sessions')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT id FROM refresh_sessions
      WHERE expires_at < now() - interval '30 days'
      ORDER BY expires_at LIMIT retention_batch_limit(p_limit) FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM refresh_sessions s USING victims v WHERE s.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

-- 4.5 One-time tokens, 30 days after they expired (used or not: a used token keeps its expiry).
CREATE FUNCTION retention_purge_user_tokens(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:user_tokens')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT id FROM user_tokens
      WHERE expires_at < now() - interval '30 days'
      ORDER BY expires_at LIMIT retention_batch_limit(p_limit) FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM user_tokens t USING victims v WHERE t.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

-- 4.6 Tenant audit trail (app_retention_owner). No FOR UPDATE: it would need an UPDATE privilege, and nobody locks these rows.
CREATE FUNCTION retention_purge_audit_logs(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:audit_logs')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT tenant_id, id FROM audit_logs
      WHERE created_at < now() - interval '2 years'
      ORDER BY created_at LIMIT retention_batch_limit(p_limit)
    ), deleted AS (
      DELETE FROM audit_logs a USING victims v WHERE a.tenant_id = v.tenant_id AND a.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

-- 4.7 Support visits, then the grants nothing references any more (the audit rows of a visit go first, in 4.6).
CREATE FUNCTION retention_purge_support_sessions(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:support_sessions')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT tenant_id, id FROM support_sessions
      WHERE opened_at < now() - interval '2 years'
      ORDER BY opened_at LIMIT retention_batch_limit(p_limit)
    ), deleted AS (
      DELETE FROM support_sessions s USING victims v WHERE s.tenant_id = v.tenant_id AND s.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

CREATE FUNCTION retention_purge_support_access_grants(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:support_access_grants')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT g.tenant_id, g.id FROM support_access_grants g
      WHERE g.expires_at < now() - interval '2 years 1 day'
        AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.tenant_id = g.tenant_id AND s.grant_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.tenant_id = g.tenant_id AND a.support_grant_id = g.id)
      ORDER BY g.expires_at LIMIT retention_batch_limit(p_limit)
    ), deleted AS (
      DELETE FROM support_access_grants g USING victims v WHERE g.tenant_id = v.tenant_id AND g.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

-- 4.8 Platform trail, 5 years: the only record of platform actions on tenants (tombstones included).
CREATE FUNCTION retention_purge_platform_audit_logs(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:platform_audit_logs')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT id FROM platform_audit_logs
      WHERE created_at < now() - interval '5 years'
      ORDER BY created_at LIMIT retention_batch_limit(p_limit)
    ), deleted AS (
      DELETE FROM platform_audit_logs l USING victims v WHERE l.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

-- 4.9 One run per night across every worker replica: the run is claimed with a row in the platform trail
-- (`retention.run_started`), and none is claimed again within 20 hours. The end of the run records what it deleted.
CREATE FUNCTION retention_start_run() RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_run_id uuid;
  BEGIN
    -- Two replicas starting together queue here; the second one then sees the first one's row.
    PERFORM pg_advisory_xact_lock(hashtext('retention:run'));
    IF EXISTS (
      SELECT 1 FROM platform_audit_logs
      WHERE action = 'retention.run_started' AND created_at > now() - interval '20 hours'
    ) THEN
      RETURN NULL;
    END IF;
    INSERT INTO platform_audit_logs (actor_user_id, action, data)
    VALUES (NULL, 'retention.run_started', '{}'::jsonb)
    RETURNING id INTO v_run_id;
    RETURN v_run_id;
  END
  $$;

-- Only counts per known step (non-negative integers) and the names of the steps that failed: nothing else can be written.
CREATE FUNCTION retention_finish_run(p_run_id uuid, p_deleted jsonb, p_failed text[], p_duration_ms integer) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_steps CONSTANT text[] := ARRAY[
      'outbox_events', 'platform_outbox_events', 'notifications', 'refresh_sessions', 'user_tokens',
      'audit_logs', 'support_sessions', 'support_access_grants', 'platform_audit_logs'
    ];
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_audit_logs WHERE id = p_run_id AND action = 'retention.run_started') THEN
      RAISE EXCEPTION 'unknown retention run' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM platform_audit_logs WHERE action = 'retention.run_finished' AND data ->> 'runId' = p_run_id::text) THEN
      RAISE EXCEPTION 'retention run already finished' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_deleted) IS DISTINCT FROM 'object' OR p_duration_ms IS NULL OR p_duration_ms < 0
       OR NOT (coalesce(p_failed, '{}') <@ v_steps) THEN
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
      'runId', p_run_id, 'deleted', p_deleted, 'failed', to_jsonb(coalesce(p_failed, '{}')), 'durationMs', p_duration_ms));
  END
  $$;

ALTER FUNCTION retention_purge_outbox_events(integer) OWNER TO app_platform;
ALTER FUNCTION retention_purge_notifications(integer) OWNER TO app_platform;
ALTER FUNCTION retention_purge_refresh_sessions(integer) OWNER TO app_platform;
ALTER FUNCTION retention_purge_user_tokens(integer) OWNER TO app_platform;
ALTER FUNCTION retention_start_run() OWNER TO app_platform;
ALTER FUNCTION retention_finish_run(uuid, jsonb, text[], integer) OWNER TO app_platform;
ALTER FUNCTION retention_purge_platform_outbox_events(integer) OWNER TO app_outbox_owner;
ALTER FUNCTION retention_purge_audit_logs(integer) OWNER TO app_retention_owner;
ALTER FUNCTION retention_purge_support_sessions(integer) OWNER TO app_retention_owner;
ALTER FUNCTION retention_purge_support_access_grants(integer) OWNER TO app_retention_owner;
ALTER FUNCTION retention_purge_platform_audit_logs(integer) OWNER TO app_retention_owner;

-- Only the worker runs retention; app_platform (whose login the API holds) does not, even on the functions it owns.
REVOKE ALL ON FUNCTION
  retention_purge_outbox_events(integer), retention_purge_platform_outbox_events(integer),
  retention_purge_notifications(integer), retention_purge_refresh_sessions(integer), retention_purge_user_tokens(integer),
  retention_purge_audit_logs(integer), retention_purge_support_sessions(integer),
  retention_purge_support_access_grants(integer), retention_purge_platform_audit_logs(integer),
  retention_start_run(), retention_finish_run(uuid, jsonb, text[], integer)
  FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION
  retention_purge_outbox_events(integer), retention_purge_platform_outbox_events(integer),
  retention_purge_notifications(integer), retention_purge_refresh_sessions(integer), retention_purge_user_tokens(integer),
  retention_purge_audit_logs(integer), retention_purge_support_sessions(integer),
  retention_purge_support_access_grants(integer), retention_purge_platform_audit_logs(integer),
  retention_start_run(), retention_finish_run(uuid, jsonb, text[], integer)
  TO app_worker;

-- ===========================================================================
-- 5. The unbatched purges nothing ever called (replaced by the functions above)
-- ===========================================================================
DROP FUNCTION purge_processed_outbox_events(interval);
DROP FUNCTION purge_processed_platform_outbox_events(interval);
DROP FUNCTION purge_read_notifications(interval);
