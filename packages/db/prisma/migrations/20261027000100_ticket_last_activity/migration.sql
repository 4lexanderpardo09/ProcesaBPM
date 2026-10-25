-- «Última actualización» of the inbox, as in the help desk: when something last happened on the ticket (its latest
-- event: created, moved, assigned, commented...). The database keeps it for every writer, so the inbox can sort by it.
ALTER TABLE tickets ADD COLUMN last_activity_at timestamptz(3);

-- Filling it in is not an edit of the tickets: their updated_at stays as it was.
ALTER TABLE tickets DISABLE TRIGGER set_updated_at;
UPDATE tickets t
SET last_activity_at = COALESCE((SELECT max(e.created_at) FROM ticket_events e WHERE e.tenant_id = t.tenant_id AND e.ticket_id = t.id), t.created_at);
ALTER TABLE tickets ENABLE TRIGGER set_updated_at;

ALTER TABLE tickets ALTER COLUMN last_activity_at SET DEFAULT now(), ALTER COLUMN last_activity_at SET NOT NULL;

CREATE FUNCTION trg_ticket_last_activity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    UPDATE tickets SET last_activity_at = GREATEST(last_activity_at, NEW.created_at)
    WHERE tenant_id = NEW.tenant_id AND id = NEW.ticket_id;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER ticket_events_last_activity AFTER INSERT ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION trg_ticket_last_activity();
