-- B17: the owner of an organization pending deletion is reminded 7 days and 1 day before the purge.
--
-- `purge_reminder_level` says which reminder went out for the current deletion request (0: none, 1: the 7-day one,
-- 2: the 1-day one). It only means something while the deletion is pending, so cancelling the request must put it back
-- to 0 (the CHECK forces it), and requesting it again starts over.
ALTER TABLE tenants ADD COLUMN purge_reminder_level smallint NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD CONSTRAINT tenants_purge_reminder_level CHECK (
  purge_reminder_level BETWEEN 0 AND 2 AND (purge_reminder_level = 0 OR status = 'PENDING_DELETION')
);

INSERT INTO platform_event_types (type, description) VALUES
  ('email.tenant_purge_reminder', 'Reminds the owner that the organization is purged in 7 days or in 1 day; the payload carries only the tenant and user ids and the days left');

-- The tenant API never queues it: only the worker's function below does, together with the level it records.
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
    IF p_type IN ('email.platform_admin_invitation', 'email.tenant_deletion_requested', 'email.tenant_purge_reminder') THEN
      RAISE EXCEPTION 'the platform e-mails are queued by their own door, not by the tenant API' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.invitation' AND p_payload ->> 'tenantId' IS DISTINCT FROM app_current_tenant()::text THEN
      RAISE EXCEPTION 'an invitation can only be queued for the tenant in context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform_outbox_events (type, payload) VALUES (p_type, p_payload) RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

-- The only door to queue a reminder (owned by the outbox owner, like the other platform e-mails since the S1 hardening).
CREATE FUNCTION enqueue_tenant_purge_reminder(p_tenant uuid, p_user uuid, p_days_left integer) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF p_tenant IS NULL OR p_user IS NULL OR p_days_left NOT IN (1, 7) THEN
      RAISE EXCEPTION 'the purge reminder needs the tenant, the owner and 7 or 1 days left' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform_outbox_events (type, payload)
    VALUES ('email.tenant_purge_reminder', jsonb_build_object('tenantId', p_tenant, 'userId', p_user, 'daysLeft', p_days_left))
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

-- Queues the reminders that are due and records them in the same transaction: a reminder is never sent twice, and a
-- failure after deciding leaves nothing recorded. The level a tenant should be at comes from the time left, so a worker
-- that was down past the 7-day mark sends only the 1-day reminder. Without an active owner the level still moves
-- (there is nobody to tell). Returns how many e-mails were queued.
CREATE FUNCTION enqueue_due_purge_reminders(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v record;
    v_queued integer := 0;
  BEGIN
    FOR v IN
      SELECT t.id,
             CASE WHEN t.purge_after <= now() + interval '1 day' THEN 2 ELSE 1 END AS level,
             (SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
              WHERE m.tenant_id = t.id AND m.is_owner AND m.status = 'ACTIVE'
              ORDER BY m.created_at, m.user_id LIMIT 1) AS owner_id
      FROM tenants t
      WHERE t.status = 'PENDING_DELETION' AND t.purge_after > now() AND t.purge_after <= now() + interval '7 days'
        AND t.purge_reminder_level < CASE WHEN t.purge_after <= now() + interval '1 day' THEN 2 ELSE 1 END
      ORDER BY t.purge_after, t.id
      LIMIT least(greatest(p_limit, 1), 100)
      FOR UPDATE OF t SKIP LOCKED
    LOOP
      UPDATE tenants SET purge_reminder_level = v.level WHERE id = v.id;
      IF v.owner_id IS NOT NULL THEN
        PERFORM enqueue_tenant_purge_reminder(v.id, v.owner_id, CASE v.level WHEN 2 THEN 1 ELSE 7 END);
        v_queued := v_queued + 1;
      END IF;
    END LOOP;
    RETURN v_queued;
  END
  $$;

-- The reminders only go out while the period runs: keep the worker's query off the whole table.
CREATE INDEX tenants_purge_reminders_due ON tenants (purge_after) WHERE status = 'PENDING_DELETION' AND purge_reminder_level < 2;

ALTER FUNCTION enqueue_tenant_purge_reminder(uuid, uuid, integer) OWNER TO app_outbox_owner;
REVOKE ALL ON FUNCTION enqueue_tenant_purge_reminder(uuid, uuid, integer) FROM PUBLIC, app_runtime, app_worker;
GRANT EXECUTE ON FUNCTION enqueue_tenant_purge_reminder(uuid, uuid, integer) TO app_platform;

ALTER FUNCTION enqueue_due_purge_reminders(integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION enqueue_due_purge_reminders(integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION enqueue_due_purge_reminders(integer) TO app_worker;
