-- The ticket page asks which of its documents are being drawn or failed: the drawing requests of one ticket, found by
-- the ticket id in their payload without reading every event of the tenant.
CREATE INDEX outbox_events_document_ticket ON outbox_events (tenant_id, (payload->>'ticketId'), created_at DESC) WHERE type = 'document.generate';
