-- The base requester role answers the steps a workflow hands back to them (correct a request, legalize an advance):
-- without these grants the ticket showed them as its assignee but nobody could move it. `transition` and `close` only
-- ever apply to a step the person holds, so this lets them act on their own steps and nothing else.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.system_role = 'REQUESTER' AND p.subject = 'Ticket' AND p.action IN ('read_assigned', 'transition', 'close')
ON CONFLICT DO NOTHING;
