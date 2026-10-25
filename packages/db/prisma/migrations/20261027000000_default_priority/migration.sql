-- As in the help desk, a ticket keeps two priorities: the one the requester chose (tickets.priority_id) and the one
-- of its workflow (the subcategory's default_priority_id), shown and filtered apart. When the requester chooses none,
-- the ticket takes the priority the organization marks as the default (the help desk's «Media»), never the
-- subcategory's. One default per organization at most.
ALTER TABLE priorities ADD COLUMN is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX priorities_one_default ON priorities (tenant_id) WHERE is_default;

UPDATE priorities SET is_default = true WHERE name = 'Media' AND is_active;
