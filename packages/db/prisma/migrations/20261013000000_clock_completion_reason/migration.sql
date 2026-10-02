-- Why an SLA clock ended, so the reports can tell "delivered the step" from "handed it to somebody else".
-- docs/base-de-datos.md §8.19.
CREATE TYPE "clock_completion_reason" AS ENUM ('STEP_EXITED', 'SIGNED', 'REASSIGNED', 'PARALLEL_CANCELLED');

ALTER TABLE ticket_sla_clocks ADD COLUMN completion_reason "clock_completion_reason";

-- Clocks that ended before the reason was recorded: the step exit is the common case and the only one that cannot be told apart.
UPDATE ticket_sla_clocks SET completion_reason = 'STEP_EXITED' WHERE completed_at IS NOT NULL;

-- A clock has a reason exactly when it has ended.
ALTER TABLE ticket_sla_clocks ADD CONSTRAINT ticket_sla_clocks_completion_reason CHECK ((completed_at IS NULL) = (completion_reason IS NULL));
