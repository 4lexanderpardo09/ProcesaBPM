-- Indexes for the reports (docs/base-de-datos.md §8.19) and a rule for error types.
-- Every report starts from the tenant and a range on one of these date columns, then reaches tickets by primary key.
-- Production note: on large tables create these with CREATE INDEX CONCURRENTLY outside the migration transaction.

CREATE INDEX tickets_closed_at ON tickets (tenant_id, closed_at) WHERE closed_at IS NOT NULL;
CREATE INDEX sla_clocks_completed ON ticket_sla_clocks (tenant_id, completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX step_visits_exited ON ticket_step_visits (tenant_id, exited_at) WHERE exited_at IS NOT NULL;
CREATE INDEX ticket_incidents_tenant_id_opened_at_idx ON ticket_incidents (tenant_id, opened_at);
CREATE INDEX ticket_errors_tenant_id_created_at_idx ON ticket_errors (tenant_id, created_at);

-- A reopening type does not also force the ticket to close (it would reopen and close in one move).
ALTER TABLE error_types ADD CONSTRAINT error_types_reopening_not_forces_close CHECK (NOT (is_reopening AND forces_close));
