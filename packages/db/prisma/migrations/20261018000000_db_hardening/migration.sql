-- ===========================================================================
-- S1 · Database hardening
-- ===========================================================================
-- Fixes the medium/low findings of the final security review (S1). No schema
-- (Prisma) change: only functions, privileges and triggers.
--
--   1. app_is_purging() was spoofable: it only compared a GUC that any runtime
--      session can set, so the API could bypass the immutability triggers for
--      its own tenant (published workflow versions and stored_files).
--   2. app_platform kept TRIGGER/MAINTAIN from the default privileges: it could
--      hide history rows with a trigger.
--   3. (documented, not changed) app_platform is the owner of the SECURITY
--      DEFINER functions, so it can re-grant or alter the ones marked "no
--      EXECUTE". Giving them a dedicated owner that also needs BYPASSRLS is a
--      large change; a compromised app_platform is already catastrophic (it has
--      BYPASSRLS and runs the purges), so this is accepted for now.
--   4. support_access_grants had no consent trigger: the DB did not check that
--      the member creating the grant is an owner or administrator.
--   5. A new membership did not have to start INVITED: any tenant could attach
--      an existing global user as ACTIVE, without their consent.
--   6. enqueue_platform_event let app_runtime queue platform-only e-mails
--      (email.platform_admin_invitation, email.tenant_deletion_requested).
--   7. auth_verify_support_session could close a support visit of another
--      tenant (the closing UPDATE only matched tenant_id + session id).

-- ===========================================================================
-- 1. The purge marker is only honoured for a privileged session.
-- ===========================================================================
-- purge_tenant() runs SECURITY DEFINER as app_platform; its deletes execute with
-- current_user = 'app_platform'. The API (app_runtime) setting app.purge_tenant
-- no longer has any effect.
CREATE OR REPLACE FUNCTION app_is_purging(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(current_setting('app.purge_tenant', true), '') = p_tenant_id::text
       AND is_privileged_session()
  $$;

-- ===========================================================================
-- 2. app_platform loses TRIGGER and MAINTAIN on the schema.
-- ===========================================================================
-- TRIGGER: create a trigger that silently drops rows from audit_logs,
-- platform_audit_logs or ticket_events. MAINTAIN (PostgreSQL 17+): VACUUM,
-- ANALYZE, REINDEX and CLUSTER. The schema owner keeps both; app_platform only
-- lost what it never needed.
REVOKE TRIGGER ON ALL TABLES IN SCHEMA public FROM app_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRIGGER ON TABLES FROM app_platform;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM app_platform';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM app_platform';
  END IF;
END
$$;

-- ===========================================================================
-- 4. A support grant is the tenant's consent: only an owner or an administrator
--    of that tenant can create it, and only for themselves as the grantor.
-- ===========================================================================
CREATE FUNCTION trg_support_grant_needs_consent() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF is_privileged_session() THEN
      RETURN NEW;
    END IF;
    IF NOT acting_user_has_full_access(NEW.tenant_id) THEN
      RAISE EXCEPTION 'only an owner or administrator can grant support access' USING ERRCODE = '42501';
    END IF;
    IF NEW.granted_by_id IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'a support grant is made by the acting member, on their own behalf' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION trg_support_grant_needs_consent() FROM PUBLIC;
CREATE TRIGGER support_grant_needs_consent BEFORE INSERT ON support_access_grants
  FOR EACH ROW EXECUTE FUNCTION trg_support_grant_needs_consent();

-- ===========================================================================
-- 5. A new membership starts INVITED.
-- ===========================================================================
-- Attaching an existing global user to a tenant as ACTIVE needs their consent
-- (the invitation is accepted later) or a privileged session (platform
-- provisioning; the identity functions, owned by app_platform, are exempt).
-- Reactivating an INACTIVE member is an UPDATE and is not affected.
CREATE OR REPLACE FUNCTION trg_guard_membership_privilege() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF is_privileged_session() THEN
      RETURN NEW;
    END IF;

    -- A new membership must start INVITED: no forcing an existing global user in as ACTIVE.
    IF TG_OP = 'INSERT' AND NEW.status <> 'INVITED' THEN
      RAISE EXCEPTION 'a new membership starts as INVITED' USING ERRCODE = '42501';
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

-- ===========================================================================
-- 6. Platform-only e-mails get their own door (only app_platform).
-- ===========================================================================
-- Same pattern as email.security_notice and email.data_export_ready: the
-- public door rejects the type and a dedicated function grants EXECUTE only to
-- app_platform (the platform login).
CREATE OR REPLACE FUNCTION enqueue_platform_event(p_type text, p_payload jsonb) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_event_types WHERE type = p_type) THEN
      RAISE EXCEPTION 'unknown platform event type %', p_type USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.security_notice' THEN
      RAISE EXCEPTION 'security notices are queued with enqueue_security_notice' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.data_export_ready' THEN
      RAISE EXCEPTION 'the data export e-mail is queued by finish_tenant_export' USING ERRCODE = '42501';
    END IF;
    IF p_type IN ('email.platform_admin_invitation', 'email.tenant_deletion_requested') THEN
      RAISE EXCEPTION 'the platform e-mails are queued by their own door, not by the tenant API' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.invitation' AND p_payload ->> 'tenantId' IS DISTINCT FROM app_current_tenant()::text THEN
      RAISE EXCEPTION 'an invitation can only be queued for the tenant in context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform_outbox_events (type, payload) VALUES (p_type, p_payload) RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

CREATE FUNCTION enqueue_platform_admin_invitation(p_user uuid) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF p_user IS NULL THEN
      RAISE EXCEPTION 'the platform admin invitation needs the user' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform_outbox_events (type, payload)
    VALUES ('email.platform_admin_invitation', jsonb_build_object('userId', p_user))
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

CREATE FUNCTION enqueue_tenant_deletion_requested(p_tenant uuid, p_user uuid) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF p_tenant IS NULL OR p_user IS NULL THEN
      RAISE EXCEPTION 'the tenant deletion e-mail needs the tenant and the owner' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform_outbox_events (type, payload)
    VALUES ('email.tenant_deletion_requested', jsonb_build_object('tenantId', p_tenant, 'userId', p_user))
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

ALTER FUNCTION enqueue_platform_admin_invitation(uuid) OWNER TO app_outbox_owner;
ALTER FUNCTION enqueue_tenant_deletion_requested(uuid, uuid) OWNER TO app_outbox_owner;
REVOKE ALL ON FUNCTION enqueue_platform_admin_invitation(uuid), enqueue_tenant_deletion_requested(uuid, uuid) FROM PUBLIC, app_runtime, app_worker;
GRANT EXECUTE ON FUNCTION enqueue_platform_admin_invitation(uuid), enqueue_tenant_deletion_requested(uuid, uuid) TO app_platform;

-- ===========================================================================
-- 7. Closing a support visit only closes the visit that was checked.
-- ===========================================================================
-- The parameters come from a signed token, but the UPDATE only matched
-- tenant_id + session id, so a caller could close another tenant's visit by
-- presenting its ids. Now the grant and the administrator must match too.
CREATE OR REPLACE FUNCTION auth_verify_support_session(p_tenant uuid, p_session uuid, p_grant uuid, p_admin uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_valid boolean;
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM support_sessions s
      JOIN support_access_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
      JOIN platform_admins pa ON pa.user_id = s.platform_user_id
      JOIN users u ON u.id = s.platform_user_id AND u.status = 'ACTIVE'
      JOIN tenants t ON t.id = s.tenant_id
      JOIN refresh_sessions rs ON rs.id = s.platform_session_id AND rs.user_id = s.platform_user_id AND rs.active_tenant_id IS NULL
        AND rs.revoked_at IS NULL AND rs.expires_at > now()
      WHERE s.tenant_id = p_tenant AND s.id = p_session AND s.grant_id = p_grant AND s.platform_user_id = p_admin
        AND s.closed_at IS NULL AND g.revoked_at IS NULL AND g.starts_at <= now() AND g.expires_at > now()
        AND t.status IN ('ACTIVE', 'SUSPENDED')
    ) INTO v_valid;
    IF NOT v_valid THEN
      UPDATE support_sessions SET closed_at = now()
      WHERE tenant_id = p_tenant AND id = p_session AND grant_id = p_grant AND platform_user_id = p_admin AND closed_at IS NULL;
    END IF;
    RETURN v_valid;
  END
  $$;
