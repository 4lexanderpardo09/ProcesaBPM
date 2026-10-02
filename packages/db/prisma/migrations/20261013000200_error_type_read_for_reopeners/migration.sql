-- Whoever can reopen a ticket or report an error has to see the error types to choose one: the supervisor and agent base roles
-- get `read ErrorType`, like the roles created from now on.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.system_role IN ('SUPERVISOR', 'AGENT') AND p.action = 'read' AND p.subject = 'ErrorType'
ON CONFLICT DO NOTHING;
