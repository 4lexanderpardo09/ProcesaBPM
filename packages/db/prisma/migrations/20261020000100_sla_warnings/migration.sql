-- SLA_WARNING: the person responsible for a step is told when 80 % of its time has gone, before it is overdue.
--
-- `warned_at` marks the clock as warned (like `alerted_at` for overdue), so each clock warns once even with several
-- workers. The window is the clock's own: from `started_at` to `due_at` (a pause already moved `due_at` later), so a
-- 4-hour step warns after 3 h 12 min and a 5-day one about a day before.
ALTER TABLE ticket_sla_clocks ADD COLUMN warned_at timestamptz(3);

-- Marks each clock and queues an `sla.warning` event in the outbox of its own tenant, in one statement (the same protocol
-- as claim_overdue_sla_clocks). A clock already overdue, paused, finished or alerted is not warned; neither is one of a
-- tenant pending deletion.
CREATE FUNCTION claim_sla_warnings(p_limit integer) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH due AS (
      SELECT tenant_id, id FROM ticket_sla_clocks c
      WHERE completed_at IS NULL AND alerted_at IS NULL AND warned_at IS NULL AND paused_at IS NULL
        AND due_at > now() AND due_at > started_at
        AND now() >= started_at + (due_at - started_at) * 0.8
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = c.tenant_id AND x.status = 'PENDING_DELETION')
      ORDER BY due_at
      LIMIT least(greatest(p_limit, 1), 1000)
      FOR UPDATE SKIP LOCKED
    ),
    marked AS (
      UPDATE ticket_sla_clocks c SET warned_at = now()
      FROM due
      WHERE c.tenant_id = due.tenant_id AND c.id = due.id
      RETURNING c.*
    ),
    queued AS (
      INSERT INTO outbox_events (tenant_id, type, payload)
      SELECT tenant_id, 'sla.warning', jsonb_build_object(
        'clockId', id, 'ticketId', ticket_id, 'visitId', visit_id, 'stepId', step_id,
        'loop', "loop", 'responsibleId', responsible_id, 'dueAt', due_at)
      FROM marked
      RETURNING 1
    )
    SELECT count(*)::integer FROM queued
  $$;

-- The running clocks not warned yet: keep the worker's query off the finished ones.
CREATE INDEX ticket_sla_clocks_warning_due ON ticket_sla_clocks (due_at) WHERE completed_at IS NULL AND warned_at IS NULL AND alerted_at IS NULL;

-- Owned by app_platform (BYPASSRLS): FORCE RLS would otherwise hide every tenant's rows from the owner.
ALTER FUNCTION claim_sla_warnings(integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION claim_sla_warnings(integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION claim_sla_warnings(integer) TO app_worker;
