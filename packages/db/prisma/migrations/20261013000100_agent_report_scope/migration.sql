-- The base AGENT role saw the reports of the whole tenant. It now sees those of its own department:
-- the existing roles that still have the unconditional grant get the same condition the new tenants are created with.
-- (A role someone already limited, or edited into a different shape, is left alone.)
UPDATE role_permissions rp
SET conditions = '{"departmentId": "${membership.departmentId}"}'::jsonb
FROM roles r, permissions p
WHERE r.tenant_id = rp.tenant_id AND r.id = rp.role_id AND r.system_role = 'AGENT'
  AND p.id = rp.permission_id AND p.action = 'read' AND p.subject = 'Report'
  AND rp.conditions IS NULL;
