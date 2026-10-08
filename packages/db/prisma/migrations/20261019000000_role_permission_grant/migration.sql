-- ===========================================================================
-- S4 · No privilege escalation through the roles
-- ===========================================================================
-- A custom role with `update Role` could grant itself (or another role) any permission except `manage all`,
-- which was the only one the database guarded: it could hand out `delete Role`, `update Membership`, and so
-- on. Now a permission can only be granted by someone who already holds it (or has full access): you cannot
-- give what you do not have. `manage all` still needs full access, because only a full-access member holds it.

CREATE FUNCTION acting_user_has_permission(p_tenant_id uuid, p_action text, p_subject text) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
      FROM memberships m
      JOIN role_permissions rp ON rp.tenant_id = m.tenant_id AND rp.role_id = m.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE m.tenant_id = p_tenant_id AND m.user_id = app_current_user() AND m.status = 'ACTIVE'
        AND (p.action = p_action OR p.action = 'manage')
        AND (p.subject = p_subject OR p.subject = 'all')
    )
  $$;

CREATE FUNCTION trg_guard_role_permission_grant() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_action text;
    v_subject text;
  BEGIN
    IF is_privileged_session() THEN
      RETURN NEW;
    END IF;
    SELECT action, subject INTO v_action, v_subject FROM permissions WHERE id = NEW.permission_id;
    IF v_action IS NULL THEN
      -- An unknown permission id: the foreign key rejects it.
      RETURN NEW;
    END IF;
    -- Replacing a role's permissions deletes its rows first, so an actor who edits their OWN role no longer
    -- appears to hold anything: they cannot grant themselves more. Editing another role, they can delegate
    -- only what they hold.
    IF NOT acting_user_has_full_access(NEW.tenant_id)
       AND NOT acting_user_has_permission(NEW.tenant_id, v_action, v_subject) THEN
      RAISE EXCEPTION 'a role can only be given permissions the actor already holds' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;

DROP TRIGGER guard_manage_all_grant ON role_permissions;
DROP FUNCTION trg_guard_manage_all_grant();
CREATE TRIGGER guard_role_permission_grant BEFORE INSERT OR UPDATE OF permission_id, role_id, tenant_id ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_guard_role_permission_grant();
