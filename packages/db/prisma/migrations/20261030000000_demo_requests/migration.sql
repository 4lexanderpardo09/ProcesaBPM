-- Demo requests from the public website (docs/base-de-datos.md §8.33).
--
-- The table belongs to the platform and to no tenant. Nobody but the platform login touches it directly:
--   - the API (app_runtime, without a session) only calls submit_demo_request, which checks, normalizes, keeps one
--     request per address a day and queues the e-mail to the sales inbox in the same transaction;
--   - the worker reads one request for that e-mail with worker_demo_request, and purges old ones (24 months) with
--     retention_purge_demo_requests;
--   - the platform console (app_platform, BYPASSRLS) lists them and marks them contacted or discarded.

SET LOCAL lock_timeout = '10s';

-- ===========================================================================
-- 1. Table
-- ===========================================================================
CREATE TYPE "demo_team_size" AS ENUM ('UNDER_20', 'FROM_20_TO_100', 'FROM_101_TO_500', 'OVER_500');

CREATE TYPE "demo_request_status" AS ENUM ('NEW', 'CONTACTED', 'DISCARDED');

CREATE TABLE "demo_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "full_name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "team_size" "demo_team_size" NOT NULL,
    "process" TEXT,
    "privacy_notice_version" SMALLINT NOT NULL,
    "status" "demo_request_status" NOT NULL DEFAULT 'NEW',
    "handled_by_id" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "demo_requests_created_at_idx" ON "demo_requests"("created_at");

CREATE INDEX "demo_requests_email_created_at_idx" ON "demo_requests"("email", "created_at");

CREATE INDEX "demo_requests_handled_by_id_idx" ON "demo_requests"("handled_by_id");

ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What the form allows, enforced here too: text the API did not trim, or longer than the form lets through, never lands.
ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_full_name_valid
  CHECK (full_name = btrim(full_name) AND char_length(full_name) BETWEEN 2 AND 120);
ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_company_valid
  CHECK (company = btrim(company) AND char_length(company) BETWEEN 2 AND 160);
ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_email_valid
  CHECK (email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_process_valid
  CHECK (process IS NULL OR (process = btrim(process) AND char_length(process) BETWEEN 1 AND 2000));
ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_privacy_notice_version_valid
  CHECK (privacy_notice_version >= 1);
-- A NEW request has not been handled; a handled one says when (who may be gone: the FK sets it to NULL).
ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_handled_consistent
  CHECK ((status = 'NEW') = (handled_at IS NULL) AND (status <> 'NEW' OR handled_by_id IS NULL));

-- Platform-only: the default privileges gave the table to the application roles.
REVOKE ALL ON demo_requests FROM PUBLIC, app_runtime, app_worker;

-- ===========================================================================
-- 2. The e-mail to the sales inbox: a platform event with its own door
-- ===========================================================================
INSERT INTO platform_event_types (type, description) VALUES
  ('email.demo_request_received', 'Tells the sales inbox about a demo request from the website; the payload carries only the request id');

-- Same body as 20261020000000, plus the new type among those that only their own door queues.
CREATE OR REPLACE FUNCTION enqueue_platform_event(p_type text, p_payload jsonb) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_event_types WHERE type = p_type) THEN
      RAISE EXCEPTION 'unknown platform event type %', p_type USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.security_notice' THEN
      RAISE EXCEPTION 'security notices are queued with enqueue_security_notice' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.data_export_ready' THEN
      RAISE EXCEPTION 'the data export e-mail is queued by finish_tenant_export' USING ERRCODE = '42501';
    END IF;
    IF p_type IN ('email.platform_admin_invitation', 'email.tenant_deletion_requested', 'email.tenant_purge_reminder', 'email.demo_request_received') THEN
      RAISE EXCEPTION 'the platform e-mails are queued by their own door, not by the tenant API' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.invitation' AND p_payload ->> 'tenantId' IS DISTINCT FROM app_current_tenant()::text THEN
      RAISE EXCEPTION 'an invitation can only be queued for the tenant in context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform_outbox_events (type, payload) VALUES (p_type, p_payload) RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

CREATE FUNCTION enqueue_demo_request_received(p_request uuid) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF p_request IS NULL THEN
      RAISE EXCEPTION 'the demo request e-mail needs the request' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform_outbox_events (type, payload)
    VALUES ('email.demo_request_received', jsonb_build_object('demoRequestId', p_request))
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

ALTER FUNCTION enqueue_demo_request_received(uuid) OWNER TO app_outbox_owner;
-- Only submit_demo_request (owned by app_platform) queues it.
REVOKE ALL ON FUNCTION enqueue_demo_request_received(uuid) FROM PUBLIC, app_runtime, app_worker;
GRANT EXECUTE ON FUNCTION enqueue_demo_request_received(uuid) TO app_platform;

-- ===========================================================================
-- 3. The API's door
-- ===========================================================================
-- Returns the request's id. One request per address a day: a repeat returns the earlier request and queues nothing, so
-- a form sent twice (or a script with the same address) does not fill the inbox. Beyond 100 new requests in the last
-- hour from everyone together it refuses with 54000 (the API answers 429): the API limits each address of origin, this
-- caps a flood from many. The advisory lock orders two requests with the same address.
CREATE FUNCTION submit_demo_request(
  p_full_name text, p_company text, p_email text, p_team_size demo_team_size, p_process text, p_privacy_notice_version smallint
) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_email text := lower(btrim(p_email));
    v_process text := nullif(btrim(p_process), '');
    v_id uuid;
  BEGIN
    IF p_full_name IS NULL OR p_company IS NULL OR p_email IS NULL OR p_team_size IS NULL OR p_privacy_notice_version IS NULL THEN
      RAISE EXCEPTION 'a demo request needs a name, a company, an e-mail, a team size and the accepted privacy notice' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('demo_request:' || v_email));
    SELECT id INTO v_id FROM demo_requests WHERE email = v_email AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
    IF (SELECT count(*) FROM demo_requests WHERE created_at > now() - interval '1 hour') >= 100 THEN
      RAISE EXCEPTION 'too many demo requests in the last hour' USING ERRCODE = '54000';
    END IF;
    INSERT INTO demo_requests (full_name, company, email, team_size, process, privacy_notice_version)
    VALUES (btrim(p_full_name), btrim(p_company), v_email, p_team_size, v_process, p_privacy_notice_version)
    RETURNING id INTO v_id;
    PERFORM enqueue_demo_request_received(v_id);
    RETURN v_id;
  END
  $$;

ALTER FUNCTION submit_demo_request(text, text, text, demo_team_size, text, smallint) OWNER TO app_platform;
REVOKE ALL ON FUNCTION submit_demo_request(text, text, text, demo_team_size, text, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_demo_request(text, text, text, demo_team_size, text, smallint) TO app_runtime;

-- ===========================================================================
-- 4. The worker's read for the e-mail
-- ===========================================================================
CREATE FUNCTION worker_demo_request(p_request uuid)
  RETURNS TABLE (out_full_name text, out_company text, out_email text, out_team_size demo_team_size, out_process text, out_created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT full_name, company, email, team_size, process, created_at FROM demo_requests WHERE id = p_request
  $$;

ALTER FUNCTION worker_demo_request(uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION worker_demo_request(uuid) FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION worker_demo_request(uuid) TO app_worker;

-- ===========================================================================
-- 5. Retention: 24 months after the request, whatever its status
-- ===========================================================================
CREATE FUNCTION retention_purge_demo_requests(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:demo_requests')) THEN
      RETURN 0;
    END IF;
    WITH victims AS (
      SELECT id FROM demo_requests
      WHERE created_at < now() - interval '24 months'
      ORDER BY created_at LIMIT retention_batch_limit(p_limit) FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM demo_requests d USING victims v WHERE d.id = v.id RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
  END
  $$;

ALTER FUNCTION retention_purge_demo_requests(integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION retention_purge_demo_requests(integer) FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION retention_purge_demo_requests(integer) TO app_worker;

-- The run summary accepts the new step. Same signature: the owner (app_platform) and the grants are kept.
CREATE OR REPLACE FUNCTION retention_finish_run(p_run_id uuid, p_deleted jsonb, p_failed text[], p_duration_ms integer, p_interrupted boolean)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_steps CONSTANT text[] := ARRAY[
      'outbox_events', 'platform_outbox_events', 'notifications', 'refresh_sessions', 'user_tokens', 'ai_jobs', 'ai_usage',
      'demo_requests', 'audit_logs', 'support_sessions', 'support_access_grants', 'platform_audit_logs', 'expire_tenant_exports'
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
