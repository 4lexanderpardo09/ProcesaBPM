-- Security e-mails (docs/base-de-datos.md §8.27): the user is told about a password change or reset, a change of the second
-- factor, a lockout and a platform sign-in. One platform event type, `email.security_notice`, with ids and a kind only; the
-- worker reads the address (and, for a sign-in, the IP and user agent of the session) when it sends the mail.
--
-- Rolling deploys: nothing an API of the previous version calls changes. The lock detection needs the claim number, so the
-- claims get NEW functions (`*_counted`) and the boolean ones stay for the old pods (dropped in a later cleanup).

SET LOCAL lock_timeout = '10s';

INSERT INTO platform_event_types (type, description) VALUES
  ('email.security_notice', 'Account security notice to the user; the payload carries only the user id, the kind and an optional session id');

-- The 24 h dedupe of the lock notices reads this index.
CREATE INDEX platform_outbox_security_notice_dedupe ON platform_outbox_events ((payload ->> 'userId'), (payload ->> 'kind'), created_at)
  WHERE type = 'email.security_notice';

-- ===========================================================================
-- 1. Enqueue
-- ===========================================================================

-- app_outbox_owner has no BYPASSRLS and the policy on `users` hides an account from a caller without `app.user_id` (the
-- login path), so the existence check is asked to an app_platform function only app_outbox_owner may run.
CREATE FUNCTION security_notice_user_exists(p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user_id)
  $$;

-- The only door for this event type (enqueue_platform_event refuses it below): a fixed list of kinds, nothing for an unknown
-- or purged account (false), and at most one lock notice of each kind per user and 24 h, so an attacker who keeps locking
-- an account (every 15 minutes) cannot flood its owner. The advisory lock serializes concurrent lock notices of one user.
CREATE FUNCTION enqueue_security_notice(p_user_id uuid, p_kind text, p_session_id uuid DEFAULT NULL) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('PASSWORD_CHANGED', 'PASSWORD_RESET', 'MFA_ENABLED', 'MFA_DISABLED', 'MFA_BACKUP_CODES_REGENERATED',
                                        'MFA_RESET_BY_SUPPORT', 'ACCOUNT_LOCKED', 'MFA_LOCKED', 'PLATFORM_ADMIN_SIGN_IN') THEN
      RAISE EXCEPTION 'unknown security notice kind' USING ERRCODE = '22023';
    END IF;
    IF p_user_id IS NULL OR NOT security_notice_user_exists(p_user_id) THEN
      RETURN false;
    END IF;
    IF p_kind IN ('ACCOUNT_LOCKED', 'MFA_LOCKED') THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('security_notice:' || p_user_id::text || ':' || p_kind, 0));
      IF EXISTS (
        SELECT 1 FROM platform_outbox_events
        WHERE type = 'email.security_notice' AND payload ->> 'userId' = p_user_id::text AND payload ->> 'kind' = p_kind
          AND created_at > now() - interval '24 hours'
      ) THEN
        RETURN false;
      END IF;
    END IF;
    INSERT INTO platform_outbox_events (type, payload)
    VALUES ('email.security_notice', jsonb_strip_nulls(jsonb_build_object('userId', p_user_id, 'kind', p_kind, 'sessionId', p_session_id)));
    RETURN true;
  END
  $$;

-- Same function as in 20261009000000, plus: a security notice only goes through enqueue_security_notice (kinds and dedupe).
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
    IF p_type = 'email.invitation' AND p_payload ->> 'tenantId' IS DISTINCT FROM app_current_tenant()::text THEN
      RAISE EXCEPTION 'an invitation can only be queued for the tenant in context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform_outbox_events (type, payload) VALUES (p_type, p_payload) RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

-- ===========================================================================
-- 2. Recipient (worker)
-- ===========================================================================

-- Nothing for a DISABLED account. The session columns only for a session of that same user.
CREATE FUNCTION worker_security_notice_recipient(p_user_id uuid, p_session_id uuid)
  RETURNS TABLE (out_email text, out_first_name text, out_time_zone text, out_ip_address text, out_user_agent text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u.email, u.first_name, u.time_zone, s.ip_address, s.user_agent
    FROM users u
    LEFT JOIN refresh_sessions s ON s.id = p_session_id AND s.user_id = u.id
    WHERE u.id = p_user_id AND u.status <> 'DISABLED'
  $$;

-- ===========================================================================
-- 3. Claims that return the claim number (NULL = refused)
-- ===========================================================================
-- Same bodies as auth_claim_login_attempt (20261015000100) and auth_claim_mfa_attempt (20261015000200). The caller knows
-- the claim that locked (number >= maximum): when its password or code was wrong, it queues the lock notice.

CREATE FUNCTION auth_claim_login_attempt_counted(p_user_id uuid, p_max_failed integer, p_lock_minutes integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE users SET
      failed_logins = failed_logins + 1,
      locked_until  = CASE WHEN failed_logins + 1 >= p_max_failed
                           THEN now() + make_interval(mins => p_lock_minutes) ELSE locked_until END
    WHERE id = p_user_id AND status = 'ACTIVE' AND (locked_until IS NULL OR locked_until <= now())
    RETURNING failed_logins
  $$;

CREATE FUNCTION auth_claim_mfa_attempt_counted(p_max_failed integer, p_lock_minutes integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_claim integer;
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    UPDATE users SET
      mfa_failed_attempts = mfa_failed_attempts + 1,
      mfa_locked_until    = CASE WHEN mfa_failed_attempts + 1 >= p_max_failed
                                 THEN now() + make_interval(mins => p_lock_minutes) ELSE mfa_locked_until END
    WHERE id = app_current_user() AND status = 'ACTIVE' AND (mfa_locked_until IS NULL OR mfa_locked_until <= now())
    RETURNING mfa_failed_attempts INTO v_claim;
    RETURN v_claim;
  END
  $$;

-- ===========================================================================
-- 4. Owners and privileges
-- ===========================================================================
ALTER FUNCTION security_notice_user_exists(uuid) OWNER TO app_platform;
ALTER FUNCTION enqueue_security_notice(uuid, text, uuid) OWNER TO app_outbox_owner;
ALTER FUNCTION worker_security_notice_recipient(uuid, uuid) OWNER TO app_platform;
ALTER FUNCTION auth_claim_login_attempt_counted(uuid, integer, integer) OWNER TO app_platform;
ALTER FUNCTION auth_claim_mfa_attempt_counted(integer, integer) OWNER TO app_platform;

REVOKE ALL ON FUNCTION
  security_notice_user_exists(uuid),
  enqueue_security_notice(uuid, text, uuid),
  worker_security_notice_recipient(uuid, uuid),
  auth_claim_login_attempt_counted(uuid, integer, integer),
  auth_claim_mfa_attempt_counted(integer, integer)
  FROM PUBLIC, app_runtime;

GRANT EXECUTE ON FUNCTION security_notice_user_exists(uuid) TO app_outbox_owner;
-- The API (and, for P4, the platform login). app_worker inherits the app_runtime grant, as with enqueue_platform_event.
GRANT EXECUTE ON FUNCTION enqueue_security_notice(uuid, text, uuid) TO app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION worker_security_notice_recipient(uuid, uuid) TO app_worker;
GRANT EXECUTE ON FUNCTION auth_claim_login_attempt_counted(uuid, integer, integer), auth_claim_mfa_attempt_counted(integer, integer) TO app_runtime;
