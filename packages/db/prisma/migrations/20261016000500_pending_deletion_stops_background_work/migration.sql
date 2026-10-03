-- A tenant that is pending deletion is closed: its members cannot sign in, so the system must not keep working on its
-- behalf either (SLA and wait alerts, random dispatch, outbox events such as notification e-mails and generated PDFs).
-- The four claim functions skip it. Anything already queued waits in place and goes with the purge (or resumes if the
-- deletion is cancelled). Same functions as before, with one added condition each.

CREATE OR REPLACE FUNCTION claim_overdue_sla_clocks(p_limit integer) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH due AS (
      SELECT tenant_id, id FROM ticket_sla_clocks c
      WHERE completed_at IS NULL AND alerted_at IS NULL AND paused_at IS NULL AND due_at <= now()
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = c.tenant_id AND x.status = 'PENDING_DELETION')
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

CREATE OR REPLACE FUNCTION claim_due_waits(p_limit integer) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH due AS (
      SELECT v.tenant_id, v.id FROM ticket_step_visits v
      JOIN tickets t ON t.tenant_id = v.tenant_id AND t.id = v.ticket_id
      WHERE v.exited_at IS NULL AND v.resume_at IS NOT NULL AND v.resume_at <= now() AND t.status = 'OPEN'
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = v.tenant_id AND x.status = 'PENDING_DELETION')
        -- A wake-up whose event never completed (it failed for good) is queued again after a day instead of stranding the ticket.
        AND (v.resume_enqueued_at IS NULL OR v.resume_enqueued_at < now() - interval '1 day')
      ORDER BY v.resume_at
      LIMIT p_limit
      FOR UPDATE OF v SKIP LOCKED
    ),
    marked AS (
      UPDATE ticket_step_visits v SET resume_enqueued_at = now()
      FROM due
      WHERE v.tenant_id = due.tenant_id AND v.id = due.id
      RETURNING v.*
    ),
    queued AS (
      INSERT INTO outbox_events (tenant_id, type, payload)
      SELECT tenant_id, 'ticket.wait_elapsed', jsonb_build_object('ticketId', ticket_id, 'visitId', id, 'stepId', step_id)
      FROM marked
      RETURNING 1
    )
    SELECT count(*)::integer FROM queued
  $$;

CREATE OR REPLACE FUNCTION claim_random_dispatch_steps(p_limit integer) RETURNS TABLE (out_tenant_id uuid, out_step_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    INSERT INTO step_runtime_states (tenant_id, step_id)
    SELECT DISTINCT c.tenant_id, c.step_id
    FROM ticket_sla_clocks c
    JOIN steps s ON s.tenant_id = c.tenant_id AND s.id = c.step_id
    WHERE c.completed_at IS NULL AND c.responsible_id IS NULL AND s.assignment_mode = 'RANDOM_DISPATCH'
    ON CONFLICT DO NOTHING;

    RETURN QUERY
    WITH due AS (
      SELECT r.tenant_id, r.step_id
      FROM step_runtime_states r
      JOIN steps s ON s.tenant_id = r.tenant_id AND s.id = r.step_id
      WHERE s.assignment_mode = 'RANDOM_DISPATCH'
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = r.tenant_id AND x.status = 'PENDING_DELETION')
        AND (r.last_dispatch_at IS NULL OR r.last_dispatch_at <= now() - make_interval(mins => coalesce(s.dispatch_interval_min, 1)))
        AND EXISTS (
          SELECT 1 FROM ticket_sla_clocks c
          JOIN tickets t ON t.tenant_id = c.tenant_id AND t.id = c.ticket_id AND t.status = 'OPEN'
          WHERE c.tenant_id = r.tenant_id AND c.step_id = r.step_id
            AND c.completed_at IS NULL AND c.responsible_id IS NULL AND c.paused_at IS NULL)
      ORDER BY r.last_dispatch_at NULLS FIRST
      LIMIT p_limit
      FOR UPDATE OF r SKIP LOCKED
    )
    UPDATE step_runtime_states r SET last_dispatch_at = now()
    FROM due
    WHERE r.tenant_id = due.tenant_id AND r.step_id = due.step_id
    RETURNING r.tenant_id, r.step_id;
  END
  $$;

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
    SET status = 'FAILED', last_error = 'lease expired after the maximum number of attempts'
    WHERE status = 'PROCESSING' AND available_at <= now() AND attempts >= p_max_attempts
      AND (p_types IS NULL OR type = ANY (p_types));

    RETURN QUERY
    UPDATE outbox_events e
    SET status = 'PROCESSING', attempts = e.attempts + 1, available_at = now() + p_lease
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
