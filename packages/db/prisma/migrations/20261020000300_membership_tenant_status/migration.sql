-- The organization picker of the sign-in tells a suspended or pending-deletion organization apart before it is chosen:
-- auth_list_memberships also returns the tenant status. A new result column needs DROP + CREATE (owner and grants again).
DROP FUNCTION auth_list_memberships(uuid);
CREATE FUNCTION auth_list_memberships(p_user_id uuid)
  RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text, membership_status membership_status, tenant_mfa_required boolean,
                 tenant_status tenant_status)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name, m.status, t.mfa_required, t.status
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id
      AND p_user_id = app_current_user()
      AND t.status IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION')
      AND m.status <> 'INACTIVE'
  $$;
ALTER FUNCTION auth_list_memberships(uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION auth_list_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_list_memberships(uuid) TO app_runtime;
