-- MFA reset by a platform administrator (docs/base-de-datos.md §8.29): a user who lost the device and the backup codes gets
-- back in through support. Never another platform administrator: their recovery is an operator runbook. One function does the whole reset in the caller's transaction: it clears the factor, revokes
-- every session of the user (tenant and platform) and closes the support visits they opened, voids the login tokens issued
-- before it, mails the user and the owners of their organizations, and writes the platform trail (reason and how the
-- identity was verified) and one row in the trail of every organization where the user is an active member.
--
-- Rolling deploys: nothing an API of the previous version calls changes its signature; auth_consume_login_token keeps it.

SET LOCAL lock_timeout = '10s';

-- ===========================================================================
-- 1. When the factor was last reset by support
-- ===========================================================================
-- Like password_changed_at: login tokens (selection, MFA challenge) issued before it are void. Not readable by the
-- application role (users has column grants: a new column is granted to nobody).
ALTER TABLE users ADD COLUMN mfa_reset_at timestamptz(3);

-- Same function as in 20261015000100, plus: a token issued before the last MFA reset is refused (strict, as with the
-- password: iat has whole seconds).
CREATE OR REPLACE FUNCTION auth_consume_login_token(p_jti uuid, p_user_id uuid, p_purpose text, p_issued_at timestamptz, p_expires_at timestamptz)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM 1 FROM users
      WHERE id = p_user_id AND status = 'ACTIVE'
        AND (password_changed_at IS NULL OR p_issued_at > password_changed_at)
        AND (mfa_reset_at IS NULL OR p_issued_at > mfa_reset_at)
      FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    INSERT INTO consumed_auth_tokens (jti, user_id, purpose, expires_at)
    VALUES (p_jti, p_user_id, p_purpose, p_expires_at)
    ON CONFLICT (jti) DO NOTHING;
    RETURN FOUND;
  END
  $$;

-- ===========================================================================
-- 2. The notice to the owners of the user's organizations
-- ===========================================================================
-- Same event type as the personal notices (email.security_notice), with the organization and the member it is about.
-- Its only caller is platform_reset_user_mfa (it runs as app_platform). A fixed list of kinds; nothing for an unknown
-- recipient.
CREATE FUNCTION enqueue_member_security_notice(p_recipient_id uuid, p_kind text, p_tenant_id uuid, p_member_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('MEMBER_MFA_RESET_BY_SUPPORT') THEN
      RAISE EXCEPTION 'unknown member security notice kind' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NULL OR p_member_id IS NULL THEN
      RAISE EXCEPTION 'a member notice needs the organization and the member' USING ERRCODE = '22023';
    END IF;
    IF p_recipient_id IS NULL OR NOT security_notice_user_exists(p_recipient_id) THEN
      RETURN false;
    END IF;
    INSERT INTO platform_outbox_events (type, payload)
    VALUES ('email.security_notice', jsonb_build_object('userId', p_recipient_id, 'kind', p_kind, 'tenantId', p_tenant_id, 'memberId', p_member_id));
    RETURN true;
  END
  $$;

-- The worker's read for that notice: the recipient's address only while they are still an active owner of the
-- organization (and their account is not DISABLED), the organization's name and the member's name. No rows = nothing to send.
CREATE FUNCTION worker_member_security_notice_recipient(p_recipient_id uuid, p_tenant_id uuid, p_member_id uuid)
  RETURNS TABLE (out_email text, out_first_name text, out_time_zone text, out_organization text, out_member_first_name text, out_member_last_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT owner_user.email, owner_user.first_name, owner_user.time_zone, t.name, member_user.first_name, member_user.last_name
    FROM memberships owner_membership
    JOIN users owner_user ON owner_user.id = owner_membership.user_id
    JOIN tenants t ON t.id = owner_membership.tenant_id
    JOIN memberships member_membership ON member_membership.tenant_id = owner_membership.tenant_id AND member_membership.user_id = p_member_id
    JOIN users member_user ON member_user.id = member_membership.user_id
    WHERE owner_membership.tenant_id = p_tenant_id AND owner_membership.user_id = p_recipient_id
      AND owner_membership.is_owner AND owner_membership.status = 'ACTIVE' AND owner_user.status <> 'DISABLED'
      AND t.status IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION')
  $$;

-- ===========================================================================
-- 3. The reset
-- ===========================================================================
-- p_admin: the platform administrator (re-checked here: in platform_admins, account ACTIVE). The user is never the
-- administrator themself nor any other platform administrator: a stolen platform session cannot remove its own factor or a
-- colleague's (recovering a platform administrator's factor is an operator runbook, not an API). The identity verification is recorded, not automated: one of four
-- methods, a reference (ticket or case id) and, for a request of an organization administrator, who asked, who must be an
-- ACTIVE owner or active admin of an organization where the user is an ACTIVE member.
-- No rows: the user does not exist or has no second factor (the API tells 404 from 409 with a read of its own).
-- Instants: clock_timestamp() taken after the row lock, so a token or a session created while this transaction waited for
-- the lock is still older than the reset and is voided.
-- The policy check of auth_disable_mfa does not apply on purpose: a member of an organization that requires MFA cannot work
-- there until they enroll again (forced at login, and 403 MFA_REQUIRED per request), and this is the only way back in.
CREATE FUNCTION platform_reset_user_mfa(p_admin uuid, p_user uuid, p_reason text, p_method text, p_reference text,
                                        p_tenant_admin_user_id uuid, p_ip_address text)
  RETURNS TABLE (out_reset_at timestamptz, out_revoked_sessions integer, out_audit_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_now        timestamptz;
    v_revoked    integer;
    v_closed     integer;
    v_tenant_ids uuid[];
    v_requested  uuid[] := '{}';
    v_audit_id   uuid;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id WHERE pa.user_id = p_admin AND u.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'not an active platform administrator' USING ERRCODE = '42501';
    END IF;
    IF p_admin = p_user THEN
      RAISE EXCEPTION 'a platform administrator cannot reset their own second factor' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user) THEN
      RAISE EXCEPTION 'the second factor of a platform administrator is not reset through the console' USING ERRCODE = '23514';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('VIDEO_CALL', 'CALLBACK_KNOWN_NUMBER', 'TENANT_ADMIN_REQUEST', 'IN_PERSON') THEN
      RAISE EXCEPTION 'unknown verification method' USING ERRCODE = '22023';
    END IF;
    -- The API counts code points (10..500 and 3..200). length() counts them only in a UTF8 database (in SQL_ASCII it counts
    -- bytes), so the upper bound is checked in bytes (4 per code point at most): whatever the API accepts passes here.
    IF length(btrim(coalesce(p_reason, ''))) < 10 OR octet_length(btrim(coalesce(p_reason, ''))) > 2000
       OR length(btrim(coalesce(p_reference, ''))) < 3 OR octet_length(btrim(coalesce(p_reference, ''))) > 800 THEN
      RAISE EXCEPTION 'the reason (10 to 500 characters) and the reference (3 to 200) are required' USING ERRCODE = '22023';
    END IF;
    IF (p_method = 'TENANT_ADMIN_REQUEST') <> (p_tenant_admin_user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'the requesting administrator goes with, and only with, a tenant administrator request' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM users WHERE id = p_user AND mfa_enabled FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    -- Milliseconds, like the timestamptz(3) columns it is written to: the instant returned is the instant stored.
    v_now := date_trunc('milliseconds', clock_timestamp());

    -- Organizations whose trail and owners hear about it: where the user is an ACTIVE member (not purged).
    SELECT coalesce(array_agg(m.tenant_id ORDER BY m.tenant_id), '{}') INTO v_tenant_ids
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user AND m.status = 'ACTIVE' AND t.status IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION');

    IF p_method = 'TENANT_ADMIN_REQUEST' THEN
      SELECT coalesce(array_agg(req.tenant_id ORDER BY req.tenant_id), '{}') INTO v_requested
      FROM memberships req
      JOIN users requester ON requester.id = req.user_id
      JOIN roles r ON r.tenant_id = req.tenant_id AND r.id = req.role_id
      WHERE req.user_id = p_tenant_admin_user_id AND req.user_id <> p_user AND requester.status = 'ACTIVE'
        AND req.status = 'ACTIVE' AND (req.is_owner OR (r.is_admin AND r.is_active))
        AND req.tenant_id = ANY (v_tenant_ids);
      IF cardinality(v_requested) = 0 THEN
        RAISE EXCEPTION 'the requester does not administer an organization of the user' USING ERRCODE = '23514';
      END IF;
    END IF;

    UPDATE users SET mfa_enabled = false, mfa_enabled_at = NULL, mfa_secret_encrypted = NULL, mfa_last_step = NULL,
                     mfa_failed_attempts = 0, mfa_locked_until = NULL, failed_logins = 0, locked_until = NULL,
                     mfa_reset_at = v_now
    WHERE id = p_user;
    DELETE FROM user_mfa_backup_codes WHERE user_id = p_user;

    -- Every session still usable, tenant and platform (realtime_session_revoked disconnects its sockets), and the support
    -- visits the user still has open from a time they were a platform administrator. The password is left alone.
    WITH revoked AS (
      UPDATE refresh_sessions SET revoked_at = v_now
      WHERE user_id = p_user AND revoked_at IS NULL AND expires_at > v_now RETURNING 1)
    SELECT count(*) INTO v_revoked FROM revoked;
    WITH closed AS (
      UPDATE support_sessions SET closed_at = v_now WHERE platform_user_id = p_user AND closed_at IS NULL RETURNING 1)
    SELECT count(*) INTO v_closed FROM closed;

    PERFORM enqueue_security_notice(p_user, 'MFA_RESET_BY_SUPPORT');
    PERFORM enqueue_member_security_notice(m.user_id, 'MEMBER_MFA_RESET_BY_SUPPORT', m.tenant_id, p_user)
    FROM memberships m
    WHERE m.tenant_id = ANY (v_tenant_ids) AND m.is_owner AND m.status = 'ACTIVE' AND m.user_id <> p_user;

    INSERT INTO platform_audit_logs (actor_user_id, action, data, ip_address)
    VALUES (p_admin, 'user.mfa_reset',
            jsonb_build_object(
              'userId', p_user,
              'reason', btrim(p_reason),
              'verification', jsonb_strip_nulls(jsonb_build_object('method', p_method, 'reference', btrim(p_reference), 'tenantAdminUserId', p_tenant_admin_user_id)),
              'revokedSessions', v_revoked,
              'closedSupportSessions', v_closed,
              'tenantIds', to_jsonb(v_tenant_ids)),
            p_ip_address)
    RETURNING id INTO v_audit_id;

    -- The organization sees that support touched one of its members, and how the identity was checked; the reason and the
    -- reference stay in the platform trail. Who asked is only written in the organizations that person administers.
    INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, entity_id, after, ip_address)
    SELECT tenant_id, NULL, 'account.mfa_reset_by_support', 'User', p_user,
           jsonb_strip_nulls(jsonb_build_object(
             'platformAuditId', v_audit_id,
             'method', p_method,
             'requestedById', CASE WHEN tenant_id = ANY (v_requested) THEN p_tenant_admin_user_id END)),
           p_ip_address
    FROM unnest(v_tenant_ids) AS tenant_id;

    RETURN QUERY SELECT v_now, v_revoked, v_audit_id;
  END
  $$;

-- ===========================================================================
-- 4. Owners and privileges
-- ===========================================================================
ALTER FUNCTION enqueue_member_security_notice(uuid, text, uuid, uuid) OWNER TO app_outbox_owner;
ALTER FUNCTION worker_member_security_notice_recipient(uuid, uuid, uuid) OWNER TO app_platform;
ALTER FUNCTION platform_reset_user_mfa(uuid, uuid, text, text, text, uuid, text) OWNER TO app_platform;

REVOKE ALL ON FUNCTION
  enqueue_member_security_notice(uuid, text, uuid, uuid),
  worker_member_security_notice_recipient(uuid, uuid, uuid),
  platform_reset_user_mfa(uuid, uuid, text, text, text, uuid, text)
  FROM PUBLIC, app_runtime;

GRANT EXECUTE ON FUNCTION enqueue_member_security_notice(uuid, text, uuid, uuid) TO app_platform;
GRANT EXECUTE ON FUNCTION worker_member_security_notice_recipient(uuid, uuid, uuid) TO app_worker;
GRANT EXECUTE ON FUNCTION platform_reset_user_mfa(uuid, uuid, text, text, text, uuid, text) TO app_platform;
