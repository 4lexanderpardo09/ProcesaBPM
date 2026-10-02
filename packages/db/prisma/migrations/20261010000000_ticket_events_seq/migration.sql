-- A total order for the timeline of a ticket. created_at comes from the application clock: it can step back (NTP
-- corrections, several API instances) and two events can share a millisecond, and uuidv7 ids are only ordered per
-- connection. The identity column is assigned by the database in commit order of the inserts, whatever the clocks say.
ALTER TABLE ticket_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX ticket_events_tenant_id_ticket_id_seq_idx ON ticket_events (tenant_id, ticket_id, seq);
