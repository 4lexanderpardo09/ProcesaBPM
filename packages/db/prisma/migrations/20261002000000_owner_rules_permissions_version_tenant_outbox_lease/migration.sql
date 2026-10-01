-- Owner and admin rules, permissions version, lease for the tenant outbox, and what the platform
-- needs to create tenants. See docs/base-de-datos.md §6 and §7.
--
--   1. roles.permissions_version: bumped by a trigger on any change of role_permissions, so a cached
--      ability is valid only for the version it was built from (revocation is immediate everywhere).
--   2. Owner and admin rules, checked at COMMIT, plus a guard against privilege escalation:
--      is_owner and is_admin now mean "full access", so who may grant them is restricted.
--   3. Tenant outbox: lease, fencing and complete/fail functions, like the platform outbox.
--   4. Platform: app_platform may enqueue, the invitation e-mail type, per-request platform session
--      check, platform audit log, and tenants can no longer change their own status or plan.

-- ===========================================================================
-- 1. roles.permissions_version
-- ===========================================================================
ALTER TABLE roles ADD COLUMN permissions_version integer NOT NULL DEFAULT 0;

-- Row-level, not SECURITY DEFINER: it runs under the caller's RLS, which is the same tenant.
CREATE FUNCTION trg_bump_role_permissions_version() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      UPDATE roles SET permissions_version = permissions_version + 1
      WHERE tenant_id = OLD.tenant_id AND id = OLD.role_id;
    END IF;
    IF TG_OP = 'INSERT'
       OR (TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.role_id) IS DISTINCT FROM (OLD.tenant_id, OLD.role_id)) THEN
      UPDATE roles SET permissions_version = permissions_version + 1
      WHERE tenant_id = NEW.tenant_id AND id = NEW.role_id;
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER bump_role_permissions_version AFTER INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_bump_role_permissions_version();

-- A decrement would make a stale cache entry valid again: the version only grows.
CREATE FUNCTION trg_role_permissions_version_monotonic() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.permissions_version < OLD.permissions_version THEN
      RAISE EXCEPTION 'permissions_version of role % cannot decrease', OLD.id USING ERRCODE = '23514';
    END IF;
    -- Only the bump trigger (depth 2: its UPDATE is fired from a trigger on role_permissions) may raise it;
    -- a member setting it to the integer maximum would break every later permission edit of the role.
    IF NEW.permissions_version <> OLD.permissions_version AND pg_trigger_depth() < 2
       AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AND current_user <> 'app_platform' THEN
      RAISE EXCEPTION 'permissions_version is maintained by the database' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER role_permissions_version_monotonic BEFORE UPDATE OF permissions_version ON roles
  FOR EACH ROW EXECUTE FUNCTION trg_role_permissions_version_monotonic();

-- ===========================================================================
-- 2. Owner and admin rules
-- ===========================================================================
-- Invariant, checked at COMMIT: when a tenant has an owner, the owner's role is an active admin role
-- and the owner's membership is ACTIVE (or INVITED and not yet accepted: the tenant is created before
-- its owner accepts the invitation). Accepting the invitation sets joined_at, so ACTIVE can never go
-- back to INVITED. A tenant that had an owner keeps one: a transfer clears the old owner and sets the
-- new one in the same transaction (the unique index memberships_one_owner is immediate, so in that order).
--
-- SECURITY DEFINER on purpose: a deferred check that runs without app.tenant_id would see no rows
-- under RLS and pass silently (e.g. auth_consume_user_token called by the API login).
CREATE FUNCTION assert_tenant_keeps_admin(p_tenant_id uuid, p_require_owner boolean) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_owner record;
  BEGIN
    -- The tenant is gone (purge_tenant cascades): nothing to protect.
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
      RETURN;
    END IF;
    SELECT m.status, m.joined_at, r.is_admin, r.is_active INTO v_owner
    FROM memberships m JOIN roles r ON r.tenant_id = m.tenant_id AND r.id = m.role_id
    WHERE m.tenant_id = p_tenant_id AND m.is_owner;
    IF NOT FOUND THEN
      IF p_require_owner THEN
        RAISE EXCEPTION 'tenant % has no owner', p_tenant_id USING ERRCODE = '23514';
      END IF;
      RETURN;
    END IF;
    IF NOT (v_owner.is_admin AND v_owner.is_active) THEN
      RAISE EXCEPTION 'the owner of tenant % must keep an active admin role', p_tenant_id USING ERRCODE = '23514';
    END IF;
    IF NOT (v_owner.status = 'ACTIVE' OR (v_owner.status = 'INVITED' AND v_owner.joined_at IS NULL)) THEN
      RAISE EXCEPTION 'the owner membership of tenant % cannot be deactivated', p_tenant_id USING ERRCODE = '23514';
    END IF;
  END
  $$;
ALTER FUNCTION assert_tenant_keeps_admin(uuid, boolean) OWNER TO app_platform;
REVOKE ALL ON FUNCTION assert_tenant_keeps_admin(uuid, boolean) FROM PUBLIC;

-- SECURITY DEFINER so that the API role, which cannot execute assert_tenant_keeps_admin, can still fire it.
CREATE FUNCTION trg_check_tenant_keeps_admin() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM assert_tenant_keeps_admin(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END,
      TG_TABLE_NAME = 'memberships'
    );
    RETURN NULL;
  END
  $$;
ALTER FUNCTION trg_check_tenant_keeps_admin() OWNER TO app_platform;
REVOKE ALL ON FUNCTION trg_check_tenant_keeps_admin() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER check_tenant_keeps_admin AFTER INSERT ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.is_owner) EXECUTE FUNCTION trg_check_tenant_keeps_admin();
CREATE CONSTRAINT TRIGGER check_tenant_keeps_admin_update AFTER UPDATE OF is_owner, status, role_id, joined_at ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.is_owner OR NEW.is_owner) EXECUTE FUNCTION trg_check_tenant_keeps_admin();
CREATE CONSTRAINT TRIGGER check_tenant_keeps_admin_delete AFTER DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.is_owner) EXECUTE FUNCTION trg_check_tenant_keeps_admin();
CREATE CONSTRAINT TRIGGER check_tenant_keeps_admin AFTER UPDATE OF is_admin, is_active ON roles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.is_admin AND OLD.is_active AND NOT (NEW.is_admin AND NEW.is_active))
  EXECUTE FUNCTION trg_check_tenant_keeps_admin();

-- Guard against privilege escalation. is_owner, an admin role and `manage all` give full access, so
-- only the platform (the sign-up, purges and the auth_* functions run as app_platform), superusers
-- (migrations) and members who already hold that power may grant it:
--   * making someone owner: the current owner during a transfer (the owner clears their own flag first,
--     which records the transfer in a transaction-local setting; the new owner is set right after);
--   * giving an admin role, making a role admin, or granting `manage all`: the owner or a member of an
--     active admin role.
CREATE FUNCTION acting_user_has_full_access(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM memberships m JOIN roles r ON r.tenant_id = m.tenant_id AND r.id = m.role_id
      WHERE m.tenant_id = p_tenant_id AND m.user_id = app_current_user() AND m.status = 'ACTIVE'
        AND (m.is_owner OR (r.is_admin AND r.is_active))
    )
  $$;

CREATE FUNCTION is_privileged_session() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT current_user = 'app_platform' OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  $$;

CREATE FUNCTION trg_guard_membership_privilege() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_new_role_is_admin boolean;
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

    -- Giving an admin role, or reactivating a member of one.
    IF TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR (NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE') THEN
      SELECT r.is_admin INTO v_new_role_is_admin FROM roles r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.role_id;
      IF coalesce(v_new_role_is_admin, false) AND NOT acting_user_has_full_access(NEW.tenant_id) THEN
        RAISE EXCEPTION 'only an administrator can give an admin role' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER guard_membership_privilege BEFORE INSERT OR UPDATE OF is_owner, role_id, status ON memberships
  FOR EACH ROW EXECUTE FUNCTION trg_guard_membership_privilege();

CREATE FUNCTION trg_guard_role_privilege() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    -- Becoming an active admin role (created, marked admin, or reactivated) is a grant of full access.
    IF NEW.is_admin AND NEW.is_active
       AND (TG_OP = 'INSERT' OR NOT (OLD.is_admin AND OLD.is_active))
       AND NOT is_privileged_session() AND NOT acting_user_has_full_access(NEW.tenant_id) THEN
      RAISE EXCEPTION 'only an administrator can create, mark or reactivate an admin role' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER guard_role_privilege BEFORE INSERT OR UPDATE OF is_admin, is_active ON roles
  FOR EACH ROW EXECUTE FUNCTION trg_guard_role_privilege();

CREATE FUNCTION trg_guard_manage_all_grant() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM permissions p WHERE p.id = NEW.permission_id AND p.action = 'manage' AND p.subject = 'all')
       AND NOT is_privileged_session() AND NOT acting_user_has_full_access(NEW.tenant_id) THEN
      RAISE EXCEPTION 'only an administrator can grant manage all' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER guard_manage_all_grant BEFORE INSERT OR UPDATE OF permission_id, role_id, tenant_id ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_guard_manage_all_grant();

-- Identity columns cannot be moved: a foreign key cascades on update, so changing memberships.user_id
-- would hand the owner flag or an admin membership to another account, and changing
-- role_permissions.role_id would move a `manage all` grant to another role.
CREATE FUNCTION trg_identity_columns_immutable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT is_privileged_session() THEN
      RAISE EXCEPTION 'the identity columns of % cannot be changed', TG_TABLE_NAME USING ERRCODE = '23001';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER memberships_identity_immutable BEFORE UPDATE OF tenant_id, user_id ON memberships
  FOR EACH ROW EXECUTE FUNCTION trg_identity_columns_immutable();
CREATE TRIGGER role_permissions_identity_immutable BEFORE UPDATE OF tenant_id, role_id ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_identity_columns_immutable();

-- An accepted membership never goes back to INVITED (the owner would have no invitation left to accept).
CREATE FUNCTION trg_membership_no_regress() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT is_privileged_session() AND OLD.joined_at IS NOT NULL AND NEW.joined_at IS NULL THEN
      RAISE EXCEPTION 'joined_at cannot be cleared' USING ERRCODE = '23514';
    END IF;
    IF NOT is_privileged_session() AND NEW.status = 'INVITED' AND OLD.status <> 'INVITED' THEN
      RAISE EXCEPTION 'a membership cannot go back to INVITED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER membership_no_regress BEFORE UPDATE OF status, joined_at ON memberships
  FOR EACH ROW EXECUTE FUNCTION trg_membership_no_regress();

-- ===========================================================================
-- 3. Tenant outbox: lease, fencing and complete/fail (same protocol as the platform outbox)
-- ===========================================================================
-- Dropped first: CREATE OR REPLACE with other arguments would create an overload and make
-- claim_outbox_events(10) ambiguous.
DROP FUNCTION claim_outbox_events(integer);

-- A claimed event is PROCESSING and available_at holds the lease expiry: if the worker dies, the
-- event is claimed again when the lease ends. `attempts` counts claims and fences stale results.
-- Owner app_platform: it reads the events of every tenant (BYPASSRLS).
CREATE FUNCTION claim_outbox_events(
  p_limit integer,
  p_lease interval DEFAULT interval '5 minutes',
  p_max_attempts integer DEFAULT 10
) RETURNS SETOF outbox_events
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE outbox_events
    SET status = 'FAILED', last_error = 'lease expired after the maximum number of attempts'
    WHERE status = 'PROCESSING' AND available_at <= now() AND attempts >= p_max_attempts;

    RETURN QUERY
    UPDATE outbox_events e
    SET status = 'PROCESSING', attempts = e.attempts + 1, available_at = now() + p_lease
    WHERE (e.tenant_id, e.id) IN (
      SELECT o.tenant_id, o.id FROM outbox_events o
      WHERE o.status IN ('PENDING', 'PROCESSING') AND o.available_at <= now() AND o.attempts < p_max_attempts
      ORDER BY o.available_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e.*;
  END
  $$;

-- complete/fail only touch the events of the tenant in app.tenant_id, so they run inside the
-- handler's own tenant transaction: the effect of the event and its completion commit together, and
-- one tenant can never close another tenant's events. Tenant outbox payloads never carry secrets.
CREATE FUNCTION complete_outbox_event(p_id uuid, p_attempt integer) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE outbox_events
      SET status = 'DONE', processed_at = now(), last_error = NULL
      WHERE tenant_id = app_current_tenant() AND id = p_id AND status = 'PROCESSING' AND attempts = p_attempt
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

CREATE FUNCTION fail_outbox_event(
  p_id uuid,
  p_attempt integer,
  p_error text,
  p_retry_at timestamptz,
  p_max_attempts integer DEFAULT 10
) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE outbox_events
      SET status = CASE WHEN p_retry_at IS NULL OR p_attempt >= p_max_attempts
                        THEN 'FAILED'::outbox_status ELSE 'PENDING'::outbox_status END,
          available_at = CASE WHEN p_retry_at IS NULL OR p_attempt >= p_max_attempts THEN available_at ELSE p_retry_at END,
          last_error = left(p_error, 2000)
      WHERE tenant_id = app_current_tenant() AND id = p_id AND status = 'PROCESSING' AND attempts = p_attempt
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

ALTER FUNCTION claim_outbox_events(integer, interval, integer) OWNER TO app_platform;
ALTER FUNCTION complete_outbox_event(uuid, integer) OWNER TO app_platform;
ALTER FUNCTION fail_outbox_event(uuid, integer, text, timestamptz, integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION
  claim_outbox_events(integer, interval, integer),
  complete_outbox_event(uuid, integer),
  fail_outbox_event(uuid, integer, text, timestamptz, integer)
  FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION
  claim_outbox_events(integer, interval, integer),
  complete_outbox_event(uuid, integer),
  fail_outbox_event(uuid, integer, text, timestamptz, integer)
  TO app_worker;

-- The API only inserts events: the state of an event is changed through the functions above.
REVOKE UPDATE, DELETE ON outbox_events FROM app_runtime;

DROP INDEX outbox_events_pending;
CREATE INDEX outbox_events_due ON outbox_events (available_at) WHERE status IN ('PENDING', 'PROCESSING');

-- ===========================================================================
-- 4. Platform
-- ===========================================================================
-- The sign-up (platform login) queues the invitation e-mail. It still cannot read the table.
GRANT EXECUTE ON FUNCTION enqueue_platform_event(text, jsonb) TO app_platform;
INSERT INTO platform_event_types (type, description) VALUES
  ('email.invitation', 'Invitation e-mail; the payload carries the one-time token for the worker');

-- A tenant must not change its own status, plan, storage or cluster: the policy tenant_self_update
-- let any tenant code reactivate a suspended tenant. Columns a tenant may edit about itself:
REVOKE UPDATE ON tenants FROM app_runtime;
GRANT UPDATE (name, time_zone, primary_color, logo_file_id, updated_at) ON tenants TO app_runtime;

-- Is this user a platform admin? Only asked about oneself (the login tells them whether to offer it).
CREATE FUNCTION auth_is_platform_admin(p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT p_user_id = app_current_user()
      AND EXISTS (
        SELECT 1 FROM platform_admins a JOIN users u ON u.id = a.user_id
        WHERE a.user_id = p_user_id AND u.status = 'ACTIVE'
      )
  $$;

-- Per-request check of a platform session: still a platform admin, account active, session live and
-- opened for the platform (active_tenant_id NULL), so it can never be mistaken for a tenant session.
CREATE FUNCTION auth_platform_access(p_user_id uuid, p_session_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT p_user_id = app_current_user()
      AND EXISTS (
        SELECT 1
        FROM platform_admins a
        JOIN users u ON u.id = a.user_id
        JOIN refresh_sessions s ON s.user_id = u.id
        WHERE a.user_id = p_user_id AND u.status = 'ACTIVE'
          AND s.id = p_session_id AND s.active_tenant_id IS NULL
          AND s.revoked_at IS NULL AND s.expires_at > now()
      )
  $$;
ALTER FUNCTION auth_is_platform_admin(uuid) OWNER TO app_platform;
ALTER FUNCTION auth_platform_access(uuid, uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION auth_is_platform_admin(uuid), auth_platform_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_is_platform_admin(uuid), auth_platform_access(uuid, uuid) TO app_runtime;

-- Platform actions bypass row-level security, so they leave their own append-only trail. No tenant_id
-- and no foreign keys: it survives the purge of the tenant it talks about.
CREATE TABLE platform_audit_logs (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id    uuid NOT NULL,
  action           text NOT NULL,
  target_tenant_id uuid,
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address       text,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT platform_audit_data_is_object CHECK (jsonb_typeof(data) = 'object')
);
CREATE INDEX platform_audit_logs_target_tenant_id_created_at_idx ON platform_audit_logs (target_tenant_id, created_at DESC);
CREATE INDEX platform_audit_logs_actor_user_id_created_at_idx ON platform_audit_logs (actor_user_id, created_at DESC);
REVOKE ALL ON platform_audit_logs FROM PUBLIC, app_runtime, app_worker;
REVOKE UPDATE, DELETE, TRUNCATE ON platform_audit_logs FROM app_platform;
