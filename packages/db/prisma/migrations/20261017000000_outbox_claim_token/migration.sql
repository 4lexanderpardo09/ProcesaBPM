-- Outbox claim fencing with a token per claim (docs/base-de-datos.md §6.4).
-- Until now a worker proved it still owned a claim with the attempt number, but a retry from the platform console resets
-- `attempts` to 0, so attempt numbers repeat: a worker stalled past its lease could complete (and send) an event that a
-- newer claim with the same number owns. Every claim now gets a fresh random `claim_token`; complete, fail and the
-- "is my claim current" checks take it instead of the attempt. `attempts` keeps its other two jobs (backoff and the
-- maximum number of claims), so a retry may still reset it. The token exists only while the event is PROCESSING: every
-- way out of PROCESSING clears it (CHECK below).
--
-- Deploy with the worker stopped: a worker of the previous version calls the dropped signatures and fails closed, but
-- its tenant "is current" check is a plain query that still works, so it could send an e-mail it can no longer complete
-- (docs/despliegue.md §5).

-- Fail fast instead of queueing every writer of the outbox behind a lock we cannot get.
SET LOCAL lock_timeout = '10s';

ALTER TABLE outbox_events ADD COLUMN claim_token uuid;
ALTER TABLE platform_outbox_events ADD COLUMN claim_token uuid;

-- Events in flight during the deploy get a token nobody holds: their old worker cannot complete them, the lease expires
-- and the new code claims them again.
UPDATE outbox_events SET claim_token = gen_random_uuid() WHERE status = 'PROCESSING';
UPDATE platform_outbox_events SET claim_token = gen_random_uuid() WHERE status = 'PROCESSING';

-- NOT VALID: it is enforced for every new and updated row at once, but the scan of the existing rows (which would hold the
-- table's exclusive lock for as long as it takes) is left to the next migration, which validates it with a weaker lock.
ALTER TABLE outbox_events ADD CONSTRAINT outbox_claim_token_iff_processing CHECK ((status = 'PROCESSING') = (claim_token IS NOT NULL)) NOT VALID;
ALTER TABLE platform_outbox_events ADD CONSTRAINT platform_outbox_claim_token_iff_processing CHECK ((status = 'PROCESSING') = (claim_token IS NOT NULL)) NOT VALID;

-- ===========================================================================
-- 1. Tenant outbox
-- ===========================================================================
-- Same function as in 20261016000500; the sweep clears the token and every claim issues a new one.
CREATE OR REPLACE FUNCTION claim_outbox_events(
  p_limit integer,
  p_types text[],
  p_lease interval DEFAULT interval '5 minutes',
  p_max_attempts integer DEFAULT 10
) RETURNS SETOF outbox_events
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE outbox_events
    SET status = 'FAILED', claim_token = NULL, last_error = 'lease expired after the maximum number of attempts'
    WHERE status = 'PROCESSING' AND available_at <= now() AND attempts >= p_max_attempts
      AND (p_types IS NULL OR type = ANY (p_types));

    RETURN QUERY
    UPDATE outbox_events e
    SET status = 'PROCESSING', attempts = e.attempts + 1, available_at = now() + p_lease, claim_token = gen_random_uuid()
    WHERE (e.tenant_id, e.id) IN (
      SELECT o.tenant_id, o.id FROM outbox_events o
      WHERE o.status IN ('PENDING', 'PROCESSING') AND o.available_at <= now() AND o.attempts < p_max_attempts
        AND (p_types IS NULL OR o.type = ANY (p_types))
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = o.tenant_id AND x.status = 'PENDING_DELETION')
      ORDER BY o.available_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e.*;
  END
  $$;

DROP FUNCTION complete_outbox_event(uuid, integer);
DROP FUNCTION fail_outbox_event(uuid, integer, text, timestamptz, integer);

-- Only the events of the tenant in app.tenant_id, inside the handler's own tenant transaction (see 20261002000000).
CREATE FUNCTION complete_outbox_event(p_id uuid, p_claim_token uuid) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE outbox_events
      SET status = 'DONE', processed_at = now(), last_error = NULL, claim_token = NULL
      WHERE tenant_id = app_current_tenant() AND id = p_id AND status = 'PROCESSING' AND claim_token = p_claim_token
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

-- The last allowed attempt is read from the row: the token proves it is the caller's own claim.
CREATE FUNCTION fail_outbox_event(
  p_id uuid,
  p_claim_token uuid,
  p_error text,
  p_retry_at timestamptz,
  p_max_attempts integer DEFAULT 10
) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE outbox_events
      SET status = CASE WHEN p_retry_at IS NULL OR attempts >= p_max_attempts
                        THEN 'FAILED'::outbox_status ELSE 'PENDING'::outbox_status END,
          available_at = CASE WHEN p_retry_at IS NULL OR attempts >= p_max_attempts THEN available_at ELSE p_retry_at END,
          last_error = left(p_error, 2000),
          claim_token = NULL
      WHERE tenant_id = app_current_tenant() AND id = p_id AND status = 'PROCESSING' AND claim_token = p_claim_token
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

-- Does this worker still own the claim? Asked before an e-mail is sent. Replaces the worker's inline query.
CREATE FUNCTION outbox_claim_is_current(p_id uuid, p_claim_token uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM outbox_events
      WHERE tenant_id = app_current_tenant() AND id = p_id AND status = 'PROCESSING' AND claim_token = p_claim_token
        AND available_at > now())
  $$;

ALTER FUNCTION complete_outbox_event(uuid, uuid) OWNER TO app_platform;
ALTER FUNCTION fail_outbox_event(uuid, uuid, text, timestamptz, integer) OWNER TO app_platform;
ALTER FUNCTION outbox_claim_is_current(uuid, uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION
  complete_outbox_event(uuid, uuid),
  fail_outbox_event(uuid, uuid, text, timestamptz, integer),
  outbox_claim_is_current(uuid, uuid)
  FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION
  complete_outbox_event(uuid, uuid),
  fail_outbox_event(uuid, uuid, text, timestamptz, integer),
  outbox_claim_is_current(uuid, uuid)
  TO app_worker;

-- ===========================================================================
-- 2. Platform outbox (functions owned by app_outbox_owner; every final state removes 'token' from the payload)
-- ===========================================================================
CREATE OR REPLACE FUNCTION claim_platform_outbox_events(
  p_limit integer,
  p_lease interval DEFAULT interval '5 minutes',
  p_max_attempts integer DEFAULT 10
) RETURNS SETOF platform_outbox_events
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE platform_outbox_events
    SET status = 'FAILED', claim_token = NULL, last_error = 'lease expired after the maximum number of attempts', payload = payload - 'token'
    WHERE status = 'PROCESSING' AND available_at <= now() AND attempts >= p_max_attempts;

    RETURN QUERY
    UPDATE platform_outbox_events e
    SET status = 'PROCESSING', attempts = e.attempts + 1, available_at = now() + p_lease, claim_token = gen_random_uuid()
    WHERE e.id IN (
      SELECT o.id FROM platform_outbox_events o
      WHERE o.status IN ('PENDING', 'PROCESSING') AND o.available_at <= now() AND o.attempts < p_max_attempts
      ORDER BY o.available_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e.*;
  END
  $$;

DROP FUNCTION complete_platform_outbox_event(uuid, integer);
DROP FUNCTION fail_platform_outbox_event(uuid, integer, text, timestamptz, integer);
DROP FUNCTION platform_outbox_claim_is_current(uuid, integer);

CREATE FUNCTION complete_platform_outbox_event(p_id uuid, p_claim_token uuid) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE platform_outbox_events
      SET status = 'DONE', processed_at = now(), last_error = NULL, payload = payload - 'token', claim_token = NULL
      WHERE id = p_id AND status = 'PROCESSING' AND claim_token = p_claim_token
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

CREATE FUNCTION fail_platform_outbox_event(
  p_id uuid,
  p_claim_token uuid,
  p_error text,
  p_retry_at timestamptz,
  p_max_attempts integer DEFAULT 10
) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE platform_outbox_events
      SET status = CASE WHEN p_retry_at IS NULL OR attempts >= p_max_attempts
                        THEN 'FAILED'::outbox_status ELSE 'PENDING'::outbox_status END,
          available_at = CASE WHEN p_retry_at IS NULL OR attempts >= p_max_attempts THEN available_at ELSE p_retry_at END,
          last_error = left(p_error, 2000),
          payload = CASE WHEN p_retry_at IS NULL OR attempts >= p_max_attempts THEN payload - 'token' ELSE payload END,
          claim_token = NULL
      WHERE id = p_id AND status = 'PROCESSING' AND claim_token = p_claim_token
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

CREATE FUNCTION platform_outbox_claim_is_current(p_id uuid, p_claim_token uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM platform_outbox_events
      WHERE id = p_id AND status = 'PROCESSING' AND claim_token = p_claim_token AND available_at > now())
  $$;

ALTER FUNCTION complete_platform_outbox_event(uuid, uuid) OWNER TO app_outbox_owner;
ALTER FUNCTION fail_platform_outbox_event(uuid, uuid, text, timestamptz, integer) OWNER TO app_outbox_owner;
ALTER FUNCTION platform_outbox_claim_is_current(uuid, uuid) OWNER TO app_outbox_owner;
REVOKE ALL ON FUNCTION
  complete_platform_outbox_event(uuid, uuid),
  fail_platform_outbox_event(uuid, uuid, text, timestamptz, integer),
  platform_outbox_claim_is_current(uuid, uuid)
  FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION
  complete_platform_outbox_event(uuid, uuid),
  fail_platform_outbox_event(uuid, uuid, text, timestamptz, integer),
  platform_outbox_claim_is_current(uuid, uuid)
  TO app_worker;
