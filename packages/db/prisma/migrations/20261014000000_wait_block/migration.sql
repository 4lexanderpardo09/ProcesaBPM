-- WAIT block: a ticket parked on a WAIT step has an open visit with `resume_at`: no SLA, no clocks, no assignees.
-- A worker wakes it up when the time comes (claim_due_waits), exactly once.
ALTER TABLE "ticket_step_visits" ADD COLUMN "resume_at" TIMESTAMPTZ(3), ADD COLUMN "resume_enqueued_at" TIMESTAMPTZ(3);

ALTER TABLE ticket_step_visits ADD CONSTRAINT step_visits_wait_has_no_sla CHECK (resume_at IS NULL OR (sla_value IS NULL AND due_at IS NULL));
ALTER TABLE ticket_step_visits ADD CONSTRAINT step_visits_resume_enqueued_needs_resume_at CHECK (resume_enqueued_at IS NULL OR resume_at IS NOT NULL);

-- Only a WAIT step is parked, and a WAIT step is always parked.
CREATE FUNCTION trg_visit_wait_matches_step() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (SELECT s.type = 'WAIT' FROM steps s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.step_id) IS DISTINCT FROM (NEW.resume_at IS NOT NULL) THEN
      RAISE EXCEPTION 'a visit has resume_at exactly when its step is a WAIT block' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER visit_wait_matches_step BEFORE INSERT ON ticket_step_visits
  FOR EACH ROW EXECUTE FUNCTION trg_visit_wait_matches_step();

-- A parked visit has no SLA clocks.
CREATE OR REPLACE FUNCTION trg_clock_matches_visit() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM ticket_step_visits v
      WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
        AND v.ticket_id = NEW.ticket_id AND v.step_id = NEW.step_id AND v."loop" = NEW."loop"
        AND v.resume_at IS NULL
    ) THEN
      RAISE EXCEPTION 'SLA clock does not match its step visit' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;

-- Cross-tenant scan for the wake-up job (SQL only, like sla_clocks_due).
CREATE INDEX step_visits_wait_due ON ticket_step_visits (resume_at)
  WHERE exited_at IS NULL AND resume_at IS NOT NULL AND resume_enqueued_at IS NULL;

-- WAIT worker: wake up the parked tickets whose time has come. One atomic statement: a visit is stamped once
-- (resume_enqueued_at), several workers never take the same visit (SKIP LOCKED), and the tenant's own work (moving the
-- ticket on) is done later by the outbox handler inside the tenant's context. Tickets that are not OPEN never match.
CREATE FUNCTION claim_due_waits(p_limit integer) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH due AS (
      SELECT v.tenant_id, v.id FROM ticket_step_visits v
      JOIN tickets t ON t.tenant_id = v.tenant_id AND t.id = v.ticket_id
      WHERE v.exited_at IS NULL AND v.resume_at IS NOT NULL AND v.resume_enqueued_at IS NULL
        AND v.resume_at <= now() AND t.status = 'OPEN'
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

ALTER FUNCTION claim_due_waits(integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION claim_due_waits(integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION claim_due_waits(integer) TO app_worker;
