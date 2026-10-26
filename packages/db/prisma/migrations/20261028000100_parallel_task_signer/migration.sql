-- Each signature of a PARALLEL step remembers the signer row (the area) it was asked for, so a document puts it in that
-- area's box whatever the order people signed in, and a round started again after a rejection keeps the areas that had
-- already signed. NULL: a signer added by hand on reassignment, or a task from before this column.
ALTER TABLE "ticket_parallel_tasks" ADD COLUMN "signer_id" UUID;

CREATE INDEX "ticket_parallel_tasks_tenant_id_signer_id_idx" ON "ticket_parallel_tasks"("tenant_id", "signer_id");

ALTER TABLE "ticket_parallel_tasks" ADD CONSTRAINT "ticket_parallel_tasks_tenant_id_signer_id_fkey" FOREIGN KEY ("tenant_id", "signer_id") REFERENCES "step_signers"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
