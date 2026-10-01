-- Platform outbox (events that belong to no tenant, such as the password reset e-mail) and the
-- worker role. See docs/base-de-datos.md §6.3, §6.4 and §12.
--
--   * platform_outbox_events: global table with NO direct access for app_runtime or app_worker.
--     The API enqueues through enqueue_platform_event(); only the worker claims, completes and
--     fails events, through SECURITY DEFINER functions.
--   * app_worker: NOLOGIN, no BYPASSRLS. It inherits app_runtime's table privileges (one source of
--     truth) and is the only role that may claim outbox events of any kind.
--   * app_outbox_owner: NOLOGIN owner of the platform outbox tables and of the functions that touch
--     them. app_platform (BYPASSRLS, whose login the API and platform jobs hold) gets NO privilege on
--     them, otherwise anyone holding that login could read the clear reset tokens.
--   * TEMP is revoked from PUBLIC: a temporary table shadows a real one inside a SECURITY DEFINER
--     function unless search_path ends with pg_temp (new functions do that; this protects the old ones).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- Same table privileges as app_runtime by inheritance, without being able to SET ROLE into it.
GRANT app_runtime TO app_worker WITH INHERIT TRUE, SET FALSE;
GRANT USAGE ON SCHEMA public TO app_worker;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_outbox_owner') THEN
    CREATE ROLE app_outbox_owner NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO app_outbox_owner;

DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

-- ---------------------------------------------------------------------------
-- Whitelist of platform event types (add a row to allow a new type).
-- ---------------------------------------------------------------------------
CREATE TABLE platform_event_types (
  type        text PRIMARY KEY,
  description text NOT NULL
);
INSERT INTO platform_event_types (type, description) VALUES
  ('email.password_reset', 'Password reset e-mail; the payload carries the one-time token for the worker');

CREATE TABLE platform_outbox_events (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  type         text NOT NULL REFERENCES platform_event_types (type),
  payload      jsonb NOT NULL,
  status       outbox_status NOT NULL DEFAULT 'PENDING',
  attempts     integer NOT NULL DEFAULT 0,
  available_at timestamptz(3) NOT NULL DEFAULT now(),
  processed_at timestamptz(3),
  last_error   text,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT platform_outbox_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT platform_outbox_payload_size CHECK (octet_length(payload::text) <= 8192),
  CONSTRAINT platform_outbox_attempts_not_negative CHECK (attempts >= 0),
  CONSTRAINT platform_outbox_done_has_date CHECK ((status = 'DONE') = (processed_at IS NOT NULL))
);
CREATE INDEX platform_outbox_events_type_idx ON platform_outbox_events (type);
-- A claimed event (PROCESSING) keeps its lease expiry in available_at, so it is also "due" when the lease ends.
CREATE INDEX platform_outbox_events_due ON platform_outbox_events (available_at) WHERE status IN ('PENDING', 'PROCESSING');

-- Default privileges give every new table to app_runtime and app_platform: take them away explicitly.
-- The owner role keeps its implicit rights; the SECURITY DEFINER functions below run as it.
ALTER TABLE platform_event_types OWNER TO app_outbox_owner;
ALTER TABLE platform_outbox_events OWNER TO app_outbox_owner;
REVOKE ALL ON platform_outbox_events, platform_event_types FROM PUBLIC, app_runtime, app_worker, app_platform;

-- ---------------------------------------------------------------------------
-- Functions (SECURITY DEFINER, owner app_outbox_owner, search_path ending in pg_temp)
-- ---------------------------------------------------------------------------

-- The API's only door: a whitelisted type and a small JSON object. No tenant or user context needed.
CREATE FUNCTION enqueue_platform_event(p_type text, p_payload jsonb) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_event_types WHERE type = p_type) THEN
      RAISE EXCEPTION 'unknown platform event type %', p_type USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform_outbox_events (type, payload) VALUES (p_type, p_payload) RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

-- Lease-based claim: a claimed event is PROCESSING and available_at holds the lease expiry, so a
-- worker that crashed does not leave the event stuck: after the lease it is claimed again.
-- `attempts` counts claims and fences the result of a worker whose lease already expired.
CREATE FUNCTION claim_platform_outbox_events(
  p_limit integer,
  p_lease interval DEFAULT interval '5 minutes',
  p_max_attempts integer DEFAULT 10
) RETURNS SETOF platform_outbox_events
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE platform_outbox_events
    SET status = 'FAILED', last_error = 'lease expired after the maximum number of attempts', payload = payload - 'token'
    WHERE status = 'PROCESSING' AND available_at <= now() AND attempts >= p_max_attempts;

    RETURN QUERY
    UPDATE platform_outbox_events e
    SET status = 'PROCESSING', attempts = e.attempts + 1, available_at = now() + p_lease
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

-- Marks the event as done and removes secrets from the payload. False when the claim is stale.
CREATE FUNCTION complete_platform_outbox_event(p_id uuid, p_attempt integer) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE platform_outbox_events
      SET status = 'DONE', processed_at = now(), last_error = NULL, payload = payload - 'token'
      WHERE id = p_id AND status = 'PROCESSING' AND attempts = p_attempt
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

-- Gives the event back for a retry at p_retry_at, or marks it FAILED when p_retry_at is NULL or when
-- this was the last allowed attempt (an event that can never be claimed again must not stay PENDING).
-- A terminal FAILED removes the token from the payload.
CREATE FUNCTION fail_platform_outbox_event(
  p_id uuid,
  p_attempt integer,
  p_error text,
  p_retry_at timestamptz,
  p_max_attempts integer DEFAULT 10
) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE platform_outbox_events
      SET status = CASE WHEN p_retry_at IS NULL OR p_attempt >= p_max_attempts
                        THEN 'FAILED'::outbox_status ELSE 'PENDING'::outbox_status END,
          available_at = CASE WHEN p_retry_at IS NULL OR p_attempt >= p_max_attempts THEN available_at ELSE p_retry_at END,
          last_error = left(p_error, 2000),
          payload = CASE WHEN p_retry_at IS NULL OR p_attempt >= p_max_attempts THEN payload - 'token' ELSE payload END
      WHERE id = p_id AND status = 'PROCESSING' AND attempts = p_attempt
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

-- Retention: sibling of purge_processed_outbox_events (same signature style, platform table).
-- DONE events by their processing date; FAILED ones (which have none) by their creation date.
CREATE FUNCTION purge_processed_platform_outbox_events(p_older_than interval) RETURNS bigint
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH deleted AS (
      DELETE FROM platform_outbox_events
      WHERE (status = 'DONE' AND processed_at < now() - p_older_than)
         OR (status = 'FAILED' AND created_at < now() - p_older_than)
      RETURNING 1
    )
    SELECT count(*) FROM deleted
  $$;

ALTER FUNCTION enqueue_platform_event(text, jsonb) OWNER TO app_outbox_owner;
ALTER FUNCTION claim_platform_outbox_events(integer, interval, integer) OWNER TO app_outbox_owner;
ALTER FUNCTION complete_platform_outbox_event(uuid, integer) OWNER TO app_outbox_owner;
ALTER FUNCTION fail_platform_outbox_event(uuid, integer, text, timestamptz, integer) OWNER TO app_outbox_owner;
ALTER FUNCTION purge_processed_platform_outbox_events(interval) OWNER TO app_outbox_owner;

REVOKE ALL ON FUNCTION
  enqueue_platform_event(text, jsonb),
  claim_platform_outbox_events(integer, interval, integer),
  complete_platform_outbox_event(uuid, integer),
  fail_platform_outbox_event(uuid, integer, text, timestamptz, integer),
  purge_processed_platform_outbox_events(interval),
  claim_outbox_events(integer)
  FROM PUBLIC, app_runtime;

-- The API enqueues. app_worker inherits that grant from app_runtime, which is harmless.
GRANT EXECUTE ON FUNCTION enqueue_platform_event(text, jsonb) TO app_runtime;

-- Only the worker claims events (of any tenant, and the platform ones) and reports the result.
GRANT EXECUTE ON FUNCTION
  claim_outbox_events(integer),
  claim_platform_outbox_events(integer, interval, integer),
  complete_platform_outbox_event(uuid, integer),
  fail_platform_outbox_event(uuid, integer, text, timestamptz, integer)
  TO app_worker;

-- Retention is run by a platform job, which can call the purge but cannot read the table.
GRANT EXECUTE ON FUNCTION purge_processed_platform_outbox_events(interval) TO app_platform;
