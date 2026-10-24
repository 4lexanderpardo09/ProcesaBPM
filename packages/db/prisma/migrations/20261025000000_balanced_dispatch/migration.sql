-- Tickets answered together in one «Procesar en lote» call share this id until they move again on their own, so a
-- RANDOM_DISPATCH step they arrive at hands them to one person. Every move of the ticket sets it or clears it.
ALTER TABLE tickets ADD COLUMN batch_id uuid;

CREATE INDEX tickets_batch_idx ON tickets (tenant_id, batch_id, current_step_id) WHERE batch_id IS NOT NULL;

-- The dispatch now goes to whoever holds the fewest open tickets of the step: it keeps no turn.
ALTER TABLE step_runtime_states DROP COLUMN last_assigned_user_id;
