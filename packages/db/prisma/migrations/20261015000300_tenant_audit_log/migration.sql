-- Tenant audit trail: the existing (so far unused) audit_logs table becomes the append-only record of administrative
-- actions and document accesses. The row is written by the application in the same transaction as the action it records.

ALTER TABLE audit_logs
  ADD COLUMN user_agent text,
  ADD COLUMN request_id text,
  -- The database clock: the trail does not trust the application's.
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD CONSTRAINT audit_logs_action_format CHECK (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' AND length(action) <= 64),
  ADD CONSTRAINT audit_logs_entity_type_format CHECK (entity_type ~ '^[A-Za-z][A-Za-z]*$' AND length(entity_type) <= 64),
  ADD CONSTRAINT audit_logs_summary_size CHECK (octet_length(coalesce(before::text, '')) <= 8192 AND octet_length(coalesce(after::text, '')) <= 8192),
  ADD CONSTRAINT audit_logs_user_agent_length CHECK (length(user_agent) <= 512),
  ADD CONSTRAINT audit_logs_request_id_length CHECK (length(request_id) <= 64);

CREATE INDEX audit_logs_tenant_id_action_created_at_idx ON audit_logs (tenant_id, action, created_at DESC);

-- Insert-only for every application login. The platform login (BYPASSRLS) must not rewrite history either, and TRUNCATE
-- is not subject to row-level security, so it is taken away from the history tables too. purge_tenant still removes a
-- purged tenant's rows through the foreign key cascade, which PostgreSQL runs with the table owner's rights.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_platform;
REVOKE TRUNCATE ON audit_logs, ticket_events, ticket_errors, ticket_signatures FROM app_runtime, app_platform;
