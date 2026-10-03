-- Wakes the API instances so they re-verify the sockets of a session, user, role or tenant at once
-- (docs/arquitectura.md §18). Ids only. The receiver never trusts the signal: it re-runs the same checks as an HTTP
-- request, so a forged signal only causes a re-check.
CREATE FUNCTION trg_realtime_access_signal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  target jsonb;
BEGIN
  IF TG_TABLE_NAME = 'refresh_sessions' THEN
    target := jsonb_build_object('s', NEW.id);
  ELSIF TG_TABLE_NAME = 'memberships' THEN
    target := jsonb_build_object('t', NEW.tenant_id, 'u', NEW.user_id);
  ELSIF TG_TABLE_NAME = 'roles' THEN
    target := jsonb_build_object('t', NEW.tenant_id, 'r', NEW.id);
  ELSIF TG_TABLE_NAME = 'tenants' THEN
    target := jsonb_build_object('t', NEW.id);
  ELSIF TG_TABLE_NAME = 'users' THEN
    target := jsonb_build_object('u', NEW.id);
  ELSE
    RAISE EXCEPTION 'trg_realtime_access_signal: unexpected table %', TG_TABLE_NAME;
  END IF;
  PERFORM pg_notify('procesabpm_realtime', (jsonb_build_object('v', 1, 'k', 'access') || target)::text);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION trg_realtime_access_signal() FROM PUBLIC;

-- A real revocation (logout, password change, MFA change, refresh-token reuse). A rotation sets replaced_by in the
-- same UPDATE and is not signalled: the client sends the new token on the socket (auth.refresh).
CREATE TRIGGER realtime_session_revoked AFTER UPDATE OF revoked_at ON refresh_sessions FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.replaced_by IS NULL)
  EXECUTE FUNCTION trg_realtime_access_signal();

CREATE TRIGGER realtime_membership_changed AFTER UPDATE OF status, role_id, is_owner, department_id, site_id, position_id ON memberships FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.role_id IS DISTINCT FROM NEW.role_id OR OLD.is_owner IS DISTINCT FROM NEW.is_owner
     OR OLD.department_id IS DISTINCT FROM NEW.department_id OR OLD.site_id IS DISTINCT FROM NEW.site_id OR OLD.position_id IS DISTINCT FROM NEW.position_id)
  EXECUTE FUNCTION trg_realtime_access_signal();

-- permissions_version is bumped by bump_role_permissions_version on any role_permissions change: one signal per change.
CREATE TRIGGER realtime_role_changed AFTER UPDATE OF permissions_version, is_active, is_admin ON roles FOR EACH ROW
  WHEN (OLD.permissions_version IS DISTINCT FROM NEW.permissions_version OR OLD.is_active IS DISTINCT FROM NEW.is_active OR OLD.is_admin IS DISTINCT FROM NEW.is_admin)
  EXECUTE FUNCTION trg_realtime_access_signal();

CREATE TRIGGER realtime_tenant_changed AFTER UPDATE OF status, mfa_required ON tenants FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.mfa_required IS DISTINCT FROM NEW.mfa_required)
  EXECUTE FUNCTION trg_realtime_access_signal();

CREATE TRIGGER realtime_user_changed AFTER UPDATE OF status, password_changed_at ON users FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.password_changed_at IS DISTINCT FROM NEW.password_changed_at)
  EXECUTE FUNCTION trg_realtime_access_signal();
