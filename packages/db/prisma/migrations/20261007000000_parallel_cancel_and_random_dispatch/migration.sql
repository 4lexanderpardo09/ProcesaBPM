-- Engine part 2: parallel signatures that are cancelled when one signer rejects, an event type for them, and
-- the claim of RANDOM_DISPATCH steps that have tickets waiting to be handed out round-robin.

-- 1. A pending signature the first rejection cancels. (ADD VALUE: the new values are not used in this migration.)
ALTER TYPE parallel_task_status ADD VALUE 'CANCELLED';
ALTER TYPE ticket_event_type ADD VALUE 'PARALLEL_TASK_COMPLETED';

-- A task is pending exactly until it has a completion time (SIGNED, REJECTED and CANCELLED all complete it).
ALTER TABLE ticket_parallel_tasks ADD CONSTRAINT parallel_tasks_completed_consistency
  CHECK ((status = 'PENDING') = (completed_at IS NULL));

-- 2. Tickets waiting for a dispatch: a running clock nobody is responsible for. Declared in SQL only, like sla_clocks_due.
CREATE INDEX sla_clocks_unassigned ON ticket_sla_clocks (tenant_id, step_id)
  WHERE completed_at IS NULL AND responsible_id IS NULL;

-- 3. Worker: the RANDOM_DISPATCH steps whose interval elapsed and that have a waiting ticket. It stamps
-- last_dispatch_at in the same statement (SKIP LOCKED: several workers never take the same step), and the
-- worker then hands the tickets out inside each tenant's own context. Only ids leave the function.
CREATE FUNCTION claim_random_dispatch_steps(p_limit integer) RETURNS TABLE (out_tenant_id uuid, out_step_id uuid)
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

ALTER FUNCTION claim_random_dispatch_steps(integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION claim_random_dispatch_steps(integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION claim_random_dispatch_steps(integer) TO app_worker;
