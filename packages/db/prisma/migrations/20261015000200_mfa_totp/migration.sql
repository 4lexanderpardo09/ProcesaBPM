-- Two-step verification (TOTP, RFC 6238): the secret is encrypted by the application (AES-256-GCM) and every state change
-- goes through narrow SECURITY DEFINER functions that act on the current user only. A tenant can require it from its
-- members. The previous generic functions (auth_set_own_mfa, auth_get_own_mfa_secret) are dropped: auth_set_own_mfa could
-- switch MFA off with no check at all.

-- ===========================================================================
-- 1. Columns and tables
-- ===========================================================================
ALTER TABLE users
  ADD COLUMN mfa_enabled_at      timestamptz(3),
  -- Replay protection: the last accepted TOTP time step. A code is accepted only for a newer step.
  ADD COLUMN mfa_last_step       bigint,
  ADD COLUMN mfa_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN mfa_locked_until    timestamptz(3),
  ADD CONSTRAINT users_mfa_enabled_has_secret
    CHECK (NOT mfa_enabled OR (mfa_secret_encrypted IS NOT NULL AND mfa_enabled_at IS NOT NULL));
-- The new columns get no column grant: app_runtime cannot read them (see SENSITIVE_USER_COLUMNS in the API).

ALTER TABLE tenants ADD COLUMN mfa_required boolean NOT NULL DEFAULT false;
GRANT UPDATE (mfa_required) ON tenants TO app_runtime;

ALTER TABLE refresh_sessions ADD COLUMN mfa_verified boolean NOT NULL DEFAULT false;
-- The API only ever updates revoked_at and replaced_by: narrow it, so mfa_verified is set when the session is created
-- and afterwards only by the functions below.
REVOKE UPDATE ON refresh_sessions FROM app_runtime;
GRANT UPDATE (revoked_at, replaced_by) ON refresh_sessions TO app_runtime;

CREATE TABLE user_mfa_backup_codes (
  user_id    uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  code_hash  text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);
-- Platform-only like user_tokens: only the functions below (owned by app_platform) touch it.
REVOKE ALL ON user_mfa_backup_codes FROM PUBLIC, app_runtime, app_worker;
ALTER TABLE user_mfa_backup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_backup_codes FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- 2. Functions (all act on app_current_user() and fail without one)
-- ===========================================================================

-- Replaces auth_get_own_mfa_secret().
CREATE FUNCTION auth_mfa_status()
  RETURNS TABLE (enabled boolean, secret_encrypted bytea, enabled_at timestamptz, backup_codes_left integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    RETURN QUERY
      SELECT u.mfa_enabled, u.mfa_secret_encrypted, u.mfa_enabled_at,
             (SELECT count(*)::integer FROM user_mfa_backup_codes c WHERE c.user_id = u.id AND c.used_at IS NULL)
      FROM users u WHERE u.id = app_current_user();
  END
  $$;

-- Enrollment start: stores the (encrypted) secret that is not active until the first code is confirmed.
CREATE FUNCTION auth_store_pending_mfa_secret(p_secret bytea) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    IF p_secret IS NULL OR length(p_secret) = 0 THEN RAISE EXCEPTION 'a secret is required' USING ERRCODE = '23514'; END IF;
    UPDATE users SET mfa_secret_encrypted = p_secret, mfa_last_step = NULL
    WHERE id = app_current_user() AND NOT mfa_enabled;
    IF NOT FOUND THEN RAISE EXCEPTION 'mfa is already enabled' USING ERRCODE = '23514'; END IF;
  END
  $$;

-- Same shape as auth_claim_login_attempt, on its own counter: the attempt is counted BEFORE the code is checked.
CREATE FUNCTION auth_claim_mfa_attempt(p_max_failed integer, p_lock_minutes integer) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_claimed boolean;
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    WITH claimed AS (
      UPDATE users SET
        mfa_failed_attempts = mfa_failed_attempts + 1,
        mfa_locked_until    = CASE WHEN mfa_failed_attempts + 1 >= p_max_failed
                                   THEN now() + make_interval(mins => p_lock_minutes) ELSE mfa_locked_until END
      WHERE id = app_current_user() AND status = 'ACTIVE' AND (mfa_locked_until IS NULL OR mfa_locked_until <= now())
      RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM claimed) INTO v_claimed;
    RETURN v_claimed;
  END
  $$;

-- The replay guard: a time step is accepted once, and only if it is newer than the last accepted one. The comparison and
-- the write are one UPDATE, so the same code (or an older one) cannot pass twice, not even concurrently. A good code
-- gives the claimed attempt back. p_enabled tells whether the code verifies an active MFA (login, disabling) or the
-- pending secret of an enrollment.
CREATE FUNCTION auth_accept_totp_step(p_step bigint, p_enabled boolean) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_accepted boolean;
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    WITH accepted AS (
      UPDATE users SET mfa_last_step = p_step, mfa_failed_attempts = 0, mfa_locked_until = NULL
      WHERE id = app_current_user() AND mfa_enabled = p_enabled AND mfa_secret_encrypted IS NOT NULL
        AND (mfa_last_step IS NULL OR mfa_last_step < p_step)
      RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM accepted) INTO v_accepted;
    RETURN v_accepted;
  END
  $$;

-- Single-use backup code: returns the codes left, or NULL when there is no unused code with that hash (or MFA is off).
CREATE FUNCTION auth_use_backup_code(p_code_hash text) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_used boolean;
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    WITH used AS (
      UPDATE user_mfa_backup_codes c SET used_at = now()
      WHERE c.user_id = app_current_user() AND c.code_hash = p_code_hash AND c.used_at IS NULL
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id AND u.mfa_enabled)
      RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM used) INTO v_used;
    IF NOT v_used THEN RETURN NULL; END IF;
    UPDATE users SET mfa_failed_attempts = 0, mfa_locked_until = NULL WHERE id = app_current_user();
    RETURN (SELECT count(*)::integer FROM user_mfa_backup_codes WHERE user_id = app_current_user() AND used_at IS NULL);
  END
  $$;

-- Backup codes are always replaced as a set of exactly ten distinct hashes.
CREATE FUNCTION assert_backup_code_set(p_hashes text[]) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_hashes IS NULL OR cardinality(p_hashes) <> 10 OR (SELECT count(DISTINCT h) FROM unnest(p_hashes) AS h) <> 10 THEN
      RAISE EXCEPTION 'exactly 10 distinct backup codes are required' USING ERRCODE = '23514';
    END IF;
  END
  $$;

-- Turns MFA on after the first code was accepted (auth_accept_totp_step(step, false)). Other sessions are revoked; the
-- one that enrolled keeps working and is marked as verified.
CREATE FUNCTION auth_enable_mfa(p_backup_hashes text[], p_keep_session uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    PERFORM assert_backup_code_set(p_backup_hashes);
    UPDATE users SET mfa_enabled = true, mfa_enabled_at = now()
    WHERE id = app_current_user() AND NOT mfa_enabled AND mfa_secret_encrypted IS NOT NULL AND mfa_last_step IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'there is no confirmed pending secret' USING ERRCODE = '23514'; END IF;
    DELETE FROM user_mfa_backup_codes WHERE user_id = app_current_user();
    INSERT INTO user_mfa_backup_codes (user_id, code_hash) SELECT app_current_user(), h FROM unnest(p_backup_hashes) AS h;
    UPDATE refresh_sessions SET revoked_at = now()
    WHERE user_id = app_current_user() AND revoked_at IS NULL AND id IS DISTINCT FROM p_keep_session;
    UPDATE refresh_sessions SET mfa_verified = true WHERE id = p_keep_session AND user_id = app_current_user();
  END
  $$;

CREATE FUNCTION auth_replace_backup_codes(p_backup_hashes text[]) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    PERFORM assert_backup_code_set(p_backup_hashes);
    PERFORM 1 FROM users WHERE id = app_current_user() AND mfa_enabled FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'mfa is not enabled' USING ERRCODE = '23514'; END IF;
    DELETE FROM user_mfa_backup_codes WHERE user_id = app_current_user();
    INSERT INTO user_mfa_backup_codes (user_id, code_hash) SELECT app_current_user(), h FROM unnest(p_backup_hashes) AS h;
  END
  $$;

-- Turns MFA off. Refused while it is required: a platform administrator, or an ACTIVE member of a tenant that requires it.
CREATE FUNCTION auth_disable_mfa(p_keep_session uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM users WHERE id = app_current_user() AND mfa_enabled FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'mfa is not enabled' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = app_current_user())
       OR EXISTS (SELECT 1 FROM memberships m JOIN tenants t ON t.id = m.tenant_id
                  WHERE m.user_id = app_current_user() AND m.status = 'ACTIVE' AND t.mfa_required AND t.status IN ('ACTIVE', 'SUSPENDED')) THEN
      RAISE EXCEPTION 'mfa is required by policy' USING ERRCODE = '23514';
    END IF;
    UPDATE users SET mfa_enabled = false, mfa_enabled_at = NULL, mfa_secret_encrypted = NULL, mfa_last_step = NULL,
                     mfa_failed_attempts = 0, mfa_locked_until = NULL
    WHERE id = app_current_user();
    DELETE FROM user_mfa_backup_codes WHERE user_id = app_current_user();
    UPDATE refresh_sessions SET revoked_at = now()
    WHERE user_id = app_current_user() AND revoked_at IS NULL AND id IS DISTINCT FROM p_keep_session;
    UPDATE refresh_sessions SET mfa_verified = false WHERE id = p_keep_session AND user_id = app_current_user();
  END
  $$;

-- Key rotation: compare-and-swap, so a concurrent change of the secret is never overwritten.
CREATE FUNCTION auth_reencrypt_mfa_secret(p_old bytea, p_new bytea) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_swapped boolean;
  BEGIN
    IF app_current_user() IS NULL THEN RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501'; END IF;
    WITH swapped AS (
      UPDATE users SET mfa_secret_encrypted = p_new WHERE id = app_current_user() AND mfa_secret_encrypted = p_old RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM swapped) INTO v_swapped;
    RETURN v_swapped;
  END
  $$;

-- The organization picker also tells which organizations require MFA (the return type changes: DROP + CREATE).
DROP FUNCTION auth_list_memberships(uuid);
CREATE FUNCTION auth_list_memberships(p_user_id uuid)
  RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text, membership_status membership_status, tenant_mfa_required boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name, m.status, t.mfa_required
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id
      AND p_user_id = app_current_user()
      AND t.status IN ('ACTIVE', 'SUSPENDED')
      AND m.status <> 'INACTIVE'
  $$;

-- Does any ACTIVE membership of the user sit in a tenant that requires MFA? (the login decides on forced enrollment)
CREATE FUNCTION auth_mfa_required_by_membership(p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT p_user_id = app_current_user() AND EXISTS (
      SELECT 1 FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = p_user_id AND m.status = 'ACTIVE' AND t.mfa_required AND t.status IN ('ACTIVE', 'SUSPENDED'))
  $$;

DROP FUNCTION auth_set_own_mfa(bytea, boolean);
DROP FUNCTION auth_get_own_mfa_secret();

-- ===========================================================================
-- 3. Owners and privileges
-- ===========================================================================
ALTER FUNCTION auth_mfa_status() OWNER TO app_platform;
ALTER FUNCTION auth_store_pending_mfa_secret(bytea) OWNER TO app_platform;
ALTER FUNCTION auth_claim_mfa_attempt(integer, integer) OWNER TO app_platform;
ALTER FUNCTION auth_accept_totp_step(bigint, boolean) OWNER TO app_platform;
ALTER FUNCTION auth_use_backup_code(text) OWNER TO app_platform;
ALTER FUNCTION auth_enable_mfa(text[], uuid) OWNER TO app_platform;
ALTER FUNCTION auth_replace_backup_codes(text[]) OWNER TO app_platform;
ALTER FUNCTION auth_disable_mfa(uuid) OWNER TO app_platform;
ALTER FUNCTION auth_reencrypt_mfa_secret(bytea, bytea) OWNER TO app_platform;
ALTER FUNCTION auth_list_memberships(uuid) OWNER TO app_platform;
ALTER FUNCTION auth_mfa_required_by_membership(uuid) OWNER TO app_platform;
ALTER FUNCTION assert_backup_code_set(text[]) OWNER TO app_platform;

REVOKE ALL ON FUNCTION auth_mfa_status(), auth_store_pending_mfa_secret(bytea), auth_claim_mfa_attempt(integer, integer),
  auth_accept_totp_step(bigint, boolean), auth_use_backup_code(text), auth_enable_mfa(text[], uuid),
  auth_replace_backup_codes(text[]), auth_disable_mfa(uuid), auth_reencrypt_mfa_secret(bytea, bytea),
  auth_list_memberships(uuid), auth_mfa_required_by_membership(uuid), assert_backup_code_set(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_mfa_status(), auth_store_pending_mfa_secret(bytea), auth_claim_mfa_attempt(integer, integer),
  auth_accept_totp_step(bigint, boolean), auth_use_backup_code(text), auth_enable_mfa(text[], uuid),
  auth_replace_backup_codes(text[]), auth_disable_mfa(uuid), auth_reencrypt_mfa_secret(bytea, bytea),
  auth_list_memberships(uuid), auth_mfa_required_by_membership(uuid) TO app_runtime;
