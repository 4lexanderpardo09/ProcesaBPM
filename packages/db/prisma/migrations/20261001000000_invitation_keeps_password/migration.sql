-- An invitation must never change the password of a user who already has one.
-- Before: INVITATION set password_hash = coalesce(new, current), so whoever held the invitation
-- token of an existing user (issued by any tenant) could replace that user's global password and
-- take over the account in every tenant. Now an invitation only sets the password of a user who
-- has none; sending one for a user who has a password raises 23514 and changes nothing.

CREATE OR REPLACE FUNCTION auth_consume_user_token(p_token_hash text, p_new_password_hash text DEFAULT NULL)
  RETURNS TABLE (user_id uuid, token_type user_token_type, invited_tenant_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
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
        UPDATE users SET password_hash = p_new_password_hash, failed_logins = 0, locked_until = NULL
        WHERE id = v_token.user_id;
        UPDATE refresh_sessions SET revoked_at = now()
        WHERE refresh_sessions.user_id = v_token.user_id AND revoked_at IS NULL;
      WHEN 'INVITATION' THEN
        UPDATE users SET password_hash = coalesce(password_hash, p_new_password_hash),
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

-- Same owner and privileges as before (CREATE OR REPLACE keeps them; restated for clarity).
ALTER FUNCTION auth_consume_user_token(text, text) OWNER TO app_platform;
