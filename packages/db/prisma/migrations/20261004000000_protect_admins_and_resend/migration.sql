-- 1. Lowering an administrator takes full access too.
--    Migration 20261002000000 guarded the GRANTS of full access (owner flag, admin roles, `manage all`).
--    The removals were open: with only `update Membership` someone could demote or deactivate any
--    administrator. Now taking a member off a role with full access, deactivating them, clearing the
--    admin flag of a role, deactivating such a role or removing its `manage all` needs full access too
--    (the platform, superusers and the auth_* functions are exempt, as for the grants).
-- 2. Sending an invitation again invalidates the earlier links of that person for that tenant.

CREATE OR REPLACE FUNCTION trg_guard_membership_privilege() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF is_privileged_session() THEN
      RETURN NEW;
    END IF;

    -- Clearing the owner flag: only the owner themself, and it opens the transfer window.
    IF TG_OP = 'UPDATE' AND OLD.is_owner AND NOT NEW.is_owner THEN
      IF OLD.user_id IS DISTINCT FROM app_current_user() THEN
        RAISE EXCEPTION 'only the owner can give up the ownership' USING ERRCODE = '42501';
      END IF;
      PERFORM set_config('app.ownership_transfer', NEW.tenant_id::text || ':' || OLD.user_id::text, true);
    END IF;

    -- Setting the owner flag.
    IF NEW.is_owner AND (TG_OP = 'INSERT' OR NOT OLD.is_owner) THEN
      IF coalesce(current_setting('app.ownership_transfer', true), '') <> NEW.tenant_id::text || ':' || coalesce(app_current_user()::text, '') THEN
        RAISE EXCEPTION 'only the owner can transfer the ownership' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Giving a role with full access, or bringing back (to INVITED or ACTIVE) a member of one.
    IF TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR (NEW.status <> 'INACTIVE' AND OLD.status = 'INACTIVE') THEN
      IF role_grants_full_access(NEW.tenant_id, NEW.role_id) AND NOT acting_user_has_full_access(NEW.tenant_id) THEN
        RAISE EXCEPTION 'only an administrator can give a role with full access' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Taking a member off a role with full access, or deactivating one who has it.
    IF TG_OP = 'UPDATE'
       AND (NEW.role_id IS DISTINCT FROM OLD.role_id OR (NEW.status = 'INACTIVE' AND OLD.status <> 'INACTIVE'))
       AND role_grants_full_access(OLD.tenant_id, OLD.role_id)
       AND NOT acting_user_has_full_access(OLD.tenant_id) THEN
      RAISE EXCEPTION 'only an administrator can lower or deactivate an administrator' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
DROP TRIGGER guard_membership_privilege ON memberships;
CREATE TRIGGER guard_membership_privilege BEFORE INSERT OR UPDATE OF is_owner, role_id, status ON memberships
  FOR EACH ROW EXECUTE FUNCTION trg_guard_membership_privilege();

CREATE OR REPLACE FUNCTION trg_guard_role_privilege() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_old_full boolean;
    v_new_full boolean;
    v_manage_all boolean;
  BEGIN
    IF is_privileged_session() THEN
      RETURN NEW;
    END IF;
    -- The flags come from OLD/NEW (the table still holds the old row in a BEFORE trigger); only the
    -- `manage all` rows are read from the table.
    SELECT EXISTS (
      SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.tenant_id = NEW.tenant_id AND rp.role_id = NEW.id AND p.action = 'manage' AND p.subject = 'all'
    ) INTO v_manage_all;
    v_new_full := NEW.is_active AND (NEW.is_admin OR v_manage_all);
    v_old_full := TG_OP = 'UPDATE' AND OLD.is_active AND (OLD.is_admin OR v_manage_all);
    -- Becoming an active role with full access (created, marked admin, or reactivated) is a grant of it;
    -- ceasing to be one (admin flag cleared, deactivated) is a removal. Either needs full access.
    IF v_new_full <> v_old_full AND NOT acting_user_has_full_access(NEW.tenant_id) THEN
      RAISE EXCEPTION 'only an administrator can change whether a role has full access' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
DROP TRIGGER guard_role_privilege ON roles;
CREATE TRIGGER guard_role_privilege BEFORE INSERT OR UPDATE OF is_admin, is_active ON roles
  FOR EACH ROW EXECUTE FUNCTION trg_guard_role_privilege();

-- Removing a `manage all` row is lowering too.
CREATE FUNCTION trg_guard_manage_all_removal() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM permissions p WHERE p.id = OLD.permission_id AND p.action = 'manage' AND p.subject = 'all')
       AND NOT is_privileged_session() AND NOT acting_user_has_full_access(OLD.tenant_id) THEN
      RAISE EXCEPTION 'only an administrator can remove manage all' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END
  $$;
CREATE TRIGGER guard_manage_all_removal BEFORE DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_guard_manage_all_removal();

-- A new invitation link replaces the earlier ones of the same person in the same tenant.
CREATE OR REPLACE FUNCTION auth_issue_user_token(
  p_user_id uuid,
  p_type user_token_type,
  p_token_hash text,
  p_expires_at timestamptz,
  p_payload jsonb DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_token_id uuid;
    v_invited_tenant uuid;
  BEGIN
    IF p_expires_at <= now() THEN
      RAISE EXCEPTION 'token expiration must be in the future' USING ERRCODE = '23514';
    END IF;

    IF p_type = 'EMAIL_CHANGE' THEN
      IF p_user_id IS DISTINCT FROM app_current_user() THEN
        RAISE EXCEPTION 'only the user can request an e-mail change' USING ERRCODE = '42501';
      END IF;
      IF p_payload ->> 'email' IS NULL THEN
        RAISE EXCEPTION 'EMAIL_CHANGE requires payload.email' USING ERRCODE = '23514';
      END IF;
    ELSIF p_type = 'INVITATION' THEN
      v_invited_tenant := app_current_tenant();
      IF NOT EXISTS (SELECT 1 FROM memberships WHERE tenant_id = v_invited_tenant AND user_id = p_user_id) THEN
        RAISE EXCEPTION 'the invited user has no membership in the current tenant' USING ERRCODE = '42501';
      END IF;
      UPDATE user_tokens SET consumed_at = now()
      WHERE user_id = p_user_id AND type = 'INVITATION' AND invited_tenant_id = v_invited_tenant AND consumed_at IS NULL;
    END IF;

    INSERT INTO user_tokens (user_id, type, token_hash, invited_tenant_id, payload, expires_at)
    VALUES (p_user_id, p_type, p_token_hash, v_invited_tenant, p_payload, p_expires_at)
    RETURNING id INTO v_token_id;
    RETURN v_token_id;
  END
  $$;
