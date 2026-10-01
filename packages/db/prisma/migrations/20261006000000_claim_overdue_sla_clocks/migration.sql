-- SLA worker: mark the overdue clocks of every tenant as alerted and enqueue one 'sla.overdue' event each
-- in that tenant's outbox. One atomic statement: a clock is alerted once (alerted_at is the mark), several
-- workers never take the same clock (SKIP LOCKED) and the per-tenant work (notifications) is done later by
-- the outbox handler inside the tenant's own context. Paused and completed clocks never match
-- (index sla_clocks_due).
CREATE FUNCTION claim_overdue_sla_clocks(p_limit integer) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH due AS (
      SELECT tenant_id, id FROM ticket_sla_clocks
      WHERE completed_at IS NULL AND alerted_at IS NULL AND paused_at IS NULL AND due_at <= now()
      ORDER BY due_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    ),
    marked AS (
      UPDATE ticket_sla_clocks c SET alerted_at = now()
      FROM due
      WHERE c.tenant_id = due.tenant_id AND c.id = due.id
      RETURNING c.*
    ),
    queued AS (
      INSERT INTO outbox_events (tenant_id, type, payload)
      SELECT tenant_id, 'sla.overdue', jsonb_build_object(
        'clockId', id, 'ticketId', ticket_id, 'visitId', visit_id, 'stepId', step_id,
        'loop', "loop", 'responsibleId', responsible_id, 'dueAt', due_at)
      FROM marked
      RETURNING 1
    )
    SELECT count(*)::integer FROM queued
  $$;

-- Owned by app_platform (BYPASSRLS): FORCE RLS would otherwise hide every tenant's rows from the owner.
ALTER FUNCTION claim_overdue_sla_clocks(integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION claim_overdue_sla_clocks(integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION claim_overdue_sla_clocks(integer) TO app_worker;
