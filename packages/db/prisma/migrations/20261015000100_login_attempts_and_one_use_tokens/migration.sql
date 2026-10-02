-- Login security: the attempt is counted atomically BEFORE the password is checked (a burst of parallel requests cannot
-- test more than the allowed passwords), the selection token is single-use, and a password change voids the tokens
-- issued before it.

ALTER TABLE users ADD COLUMN password_changed_at timestamptz(3);

-- ===========================================================================
-- 1. Attempts: claim first, give the slot back when the password was right
-- ===========================================================================

-- Claims one login attempt; false = refused (locked, not ACTIVE or unknown id). The increment is pessimistic (as if the
-- password will be wrong) and the UPDATE re-checks the lock on the newest row version after waiting for a concurrent
-- claim, so the claim that reaches the maximum locks the account for every later one. Lock decisions use the database clock.
CREATE FUNCTION auth_claim_login_attempt(p_user_id uuid, p_max_failed integer, p_lock_minutes integer)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH claimed AS (
      UPDATE users SET
        failed_logins = failed_logins + 1,
        locked_until  = CASE WHEN failed_logins + 1 >= p_max_failed
                             THEN now() + make_interval(mins => p_lock_minutes) ELSE locked_until END
      WHERE id = p_user_id AND status = 'ACTIVE' AND (locked_until IS NULL OR locked_until <= now())
      RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM claimed)
  $$;

-- The password was right: the claimed slot is given back. last_login_at only when the sign-in is complete.
CREATE FUNCTION auth_record_password_success(p_user_id uuid, p_signed_in boolean) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE users SET failed_logins = 0, locked_until = NULL,
                     last_login_at = CASE WHEN p_signed_in THEN now() ELSE last_login_at END
    WHERE id = p_user_id
  $$;

DROP FUNCTION auth_register_login_attempt(uuid, boolean, integer, integer);

-- ===========================================================================
-- 2. One-use login tokens
-- ===========================================================================

CREATE TABLE consumed_auth_tokens (
  jti         uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('TENANT_SELECTION', 'MFA_CHALLENGE')),
  expires_at  timestamptz(3) NOT NULL,
  consumed_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX consumed_auth_tokens_user_id_idx ON consumed_auth_tokens (user_id);
CREATE INDEX consumed_auth_tokens_expires_at_idx ON consumed_auth_tokens (expires_at);
-- Platform-only like user_tokens: only the SECURITY DEFINER functions below touch it.
REVOKE ALL ON consumed_auth_tokens FROM PUBLIC, app_runtime, app_worker;
ALTER TABLE consumed_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumed_auth_tokens FORCE ROW LEVEL SECURITY;

-- Consumes a token once. Also enforces "issued after the last password change" and an ACTIVE account. FOR SHARE orders a
-- concurrent password change against this consumption: either the change waits, or this call sees the new timestamp.
-- The comparison is strict: `iat` has whole seconds, so a token issued in the same second as the change is refused.
CREATE FUNCTION auth_consume_login_token(p_jti uuid, p_user_id uuid, p_purpose text, p_issued_at timestamptz, p_expires_at timestamptz)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_expires_at <= now() THEN RETURN false; END IF;
    PERFORM 1 FROM users
      WHERE id = p_user_id AND status = 'ACTIVE'
        AND (password_changed_at IS NULL OR p_issued_at > password_changed_at)
      FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    INSERT INTO consumed_auth_tokens (jti, user_id, purpose, expires_at)
    VALUES (p_jti, p_user_id, p_purpose, p_expires_at)
    ON CONFLICT (jti) DO NOTHING;
    RETURN FOUND;
  END
  $$;

-- Rows only matter until the token expires (minutes).
CREATE FUNCTION purge_consumed_auth_tokens() RETURNS bigint
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH purged AS (DELETE FROM consumed_auth_tokens WHERE expires_at < now() - interval '1 hour' RETURNING 1)
    SELECT count(*) FROM purged
  $$;

-- ===========================================================================
-- 3. Password changes
-- ===========================================================================

-- Replaces auth_set_own_password: records the change, clears the lockout and revokes every other session.
CREATE FUNCTION auth_change_own_password(p_new_password_hash text, p_keep_session_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN
      RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501';
    END IF;
    UPDATE users SET password_hash = p_new_password_hash, password_changed_at = now(), failed_logins = 0, locked_until = NULL
    WHERE id = app_current_user();
    UPDATE refresh_sessions SET revoked_at = now()
    WHERE user_id = app_current_user() AND revoked_at IS NULL AND id IS DISTINCT FROM p_keep_session_id;
  END
  $$;

DROP FUNCTION auth_set_own_password(text);

-- Same body as before plus the password-change timestamp (reset and invitation that sets a password), and the invitation
-- that sets a password also clears the lockout.
CREATE OR REPLACE FUNCTION auth_consume_user_token(p_token_hash text, p_new_password_hash text DEFAULT NULL)
  RETURNS TABLE (user_id uuid, token_type user_token_type, invited_tenant_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_token user_tokens%ROWTYPE;
    v_has_password boolean;
  BEGIN
    SELECT * INTO v_token FROM user_tokens WHERE token_hash = p_token_hash FOR UPDATE;
    IF NOT FOUND OR v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now() THEN
      RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '42501';
    END IF;

    SELECT u.password_hash IS NOT NULL INTO v_has_password FROM users u WHERE u.id = v_token.user_id;

    IF v_token.type IN ('PASSWORD_RESET', 'INVITATION') AND p_new_password_hash IS NULL
       AND (v_token.type = 'PASSWORD_RESET' OR NOT v_has_password) THEN
      RAISE EXCEPTION 'a new password is required' USING ERRCODE = '23514';
    END IF;

    IF v_token.type = 'INVITATION' AND p_new_password_hash IS NOT NULL AND v_has_password THEN
      RAISE EXCEPTION 'the invited user already has a password' USING ERRCODE = '23514';
    END IF;

    CASE v_token.type
      WHEN 'PASSWORD_RESET' THEN
        UPDATE users SET password_hash = p_new_password_hash, password_changed_at = now(), failed_logins = 0, locked_until = NULL
        WHERE id = v_token.user_id;
        UPDATE refresh_sessions SET revoked_at = now()
        WHERE refresh_sessions.user_id = v_token.user_id AND revoked_at IS NULL;
      WHEN 'INVITATION' THEN
        UPDATE users SET password_hash = coalesce(password_hash, p_new_password_hash),
                         password_changed_at = CASE WHEN p_new_password_hash IS NOT NULL THEN now() ELSE password_changed_at END,
                         failed_logins = CASE WHEN p_new_password_hash IS NOT NULL THEN 0 ELSE failed_logins END,
                         locked_until = CASE WHEN p_new_password_hash IS NOT NULL THEN NULL ELSE locked_until END,
                         email_verified_at = coalesce(email_verified_at, now())
        WHERE id = v_token.user_id;
        UPDATE memberships SET status = 'ACTIVE', joined_at = now()
        WHERE tenant_id = v_token.invited_tenant_id AND memberships.user_id = v_token.user_id
          AND status = 'INVITED';
      WHEN 'EMAIL_VERIFICATION' THEN
        UPDATE users SET email_verified_at = now() WHERE id = v_token.user_id;
      WHEN 'EMAIL_CHANGE' THEN
        UPDATE users SET email = lower(trim(v_token.payload ->> 'email')), email_verified_at = now()
        WHERE id = v_token.user_id;
    END CASE;

    UPDATE user_tokens SET consumed_at = now() WHERE id = v_token.id;
    RETURN QUERY SELECT v_token.user_id, v_token.type, v_token.invited_tenant_id;
  END
  $$;

-- ===========================================================================
-- 4. Owners and privileges
-- ===========================================================================
ALTER FUNCTION auth_claim_login_attempt(uuid, integer, integer) OWNER TO app_platform;
ALTER FUNCTION auth_record_password_success(uuid, boolean) OWNER TO app_platform;
ALTER FUNCTION auth_consume_login_token(uuid, uuid, text, timestamptz, timestamptz) OWNER TO app_platform;
ALTER FUNCTION purge_consumed_auth_tokens() OWNER TO app_platform;
ALTER FUNCTION auth_change_own_password(text, uuid) OWNER TO app_platform;

REVOKE ALL ON FUNCTION auth_claim_login_attempt(uuid, integer, integer), auth_record_password_success(uuid, boolean),
  auth_consume_login_token(uuid, uuid, text, timestamptz, timestamptz), purge_consumed_auth_tokens(),
  auth_change_own_password(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_claim_login_attempt(uuid, integer, integer), auth_record_password_success(uuid, boolean),
  auth_consume_login_token(uuid, uuid, text, timestamptz, timestamptz), auth_change_own_password(text, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION purge_consumed_auth_tokens() TO app_worker;
