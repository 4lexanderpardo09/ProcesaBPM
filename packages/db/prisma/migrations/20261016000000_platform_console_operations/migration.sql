-- Platform console, operations: the administrators can see which platform events ended FAILED and queue them again.
-- The platform outbox is closed to the BYPASSRLS login of app_platform on purpose (its rows once carried one-time
-- tokens), so both operations are SECURITY DEFINER functions owned by app_outbox_owner. Neither returns the payload.

CREATE FUNCTION list_failed_platform_outbox_events(p_limit integer, p_offset integer DEFAULT 0)
  RETURNS TABLE (out_id uuid, out_type text, out_attempts integer, out_last_error text, out_created_at timestamptz, out_total bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT e.id, e.type, e.attempts, left(e.last_error, 500), e.created_at, count(*) OVER ()
    FROM platform_outbox_events e
    WHERE e.status = 'FAILED'
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT least(greatest(p_limit, 1), 100) OFFSET greatest(p_offset, 0)
  $$;

-- Only a FAILED event can be queued again; it restarts with a clean attempt counter. Returns whether one was queued.
CREATE FUNCTION retry_failed_platform_outbox_event(p_id uuid) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE platform_outbox_events
      SET status = 'PENDING', attempts = 0, available_at = now(), last_error = NULL
      WHERE id = p_id AND status = 'FAILED'
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

ALTER FUNCTION list_failed_platform_outbox_events(integer, integer) OWNER TO app_outbox_owner;
ALTER FUNCTION retry_failed_platform_outbox_event(uuid) OWNER TO app_outbox_owner;
REVOKE ALL ON FUNCTION list_failed_platform_outbox_events(integer, integer), retry_failed_platform_outbox_event(uuid) FROM PUBLIC, app_runtime, app_worker;
GRANT EXECUTE ON FUNCTION list_failed_platform_outbox_events(integer, integer), retry_failed_platform_outbox_event(uuid) TO app_platform;
