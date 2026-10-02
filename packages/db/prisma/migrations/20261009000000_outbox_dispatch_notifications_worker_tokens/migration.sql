-- Outbox dispatch, tokens issued by the worker and notifications. See docs/base-de-datos.md §6.3, §6.4 and §8.

-- ===========================================================================
-- 1. The worker issues the one-time tokens of invitations and password resets
-- ===========================================================================
-- The API only queues ids ({userId} / {tenantId, userId}); the clear token never exists in the database. The worker
-- derives it from the event id (HMAC with a key only it has) and these functions store its hash, bound to the event:
-- a retry after a crash re-derives the same token, so it finds its row instead of issuing a second one.
ALTER TABLE user_tokens ADD COLUMN source_event_id uuid;
-- No foreign key: outbox rows are purged. NULLs (tokens not issued by an event) stay distinct.
CREATE UNIQUE INDEX user_tokens_source_event_id_key ON user_tokens (source_event_id);

CREATE FUNCTION worker_issue_password_reset_token(p_event_id uuid, p_user_id uuid, p_token_hash text, p_ttl interval)
  RETURNS TABLE (out_email text, out_first_name text, out_locale text, out_expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user users%ROWTYPE;
    v_token user_tokens%ROWTYPE;
  BEGIN
    -- Two events of the same person (a resend) are issued one after the other, so the later link replaces the earlier.
    PERFORM pg_advisory_xact_lock(hashtextextended('user-token:' || p_user_id::text, 0));
    SELECT * INTO v_user FROM users WHERE id = p_user_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
      RETURN;
    END IF;

    SELECT * INTO v_token FROM user_tokens WHERE source_event_id = p_event_id FOR UPDATE;
    IF FOUND THEN
      IF v_token.user_id <> p_user_id OR v_token.type <> 'PASSWORD_RESET' THEN
        RAISE EXCEPTION 'event % issued a token for another purpose', p_event_id USING ERRCODE = '42501';
      END IF;
      -- Used, superseded by a newer request, or expired: there is nothing left to send.
      IF v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now() THEN
        RETURN;
      END IF;
      IF v_token.token_hash <> p_token_hash THEN
        UPDATE user_tokens SET token_hash = p_token_hash WHERE id = v_token.id;
      END IF;
      RETURN QUERY SELECT v_user.email, v_user.first_name, v_user.locale, v_token.expires_at;
      RETURN;
    END IF;

    UPDATE user_tokens SET consumed_at = now() WHERE user_id = p_user_id AND type = 'PASSWORD_RESET' AND consumed_at IS NULL;
    INSERT INTO user_tokens (user_id, type, token_hash, expires_at, source_event_id)
    VALUES (p_user_id, 'PASSWORD_RESET', p_token_hash, now() + p_ttl, p_event_id)
    RETURNING expires_at INTO v_token.expires_at;
    RETURN QUERY SELECT v_user.email, v_user.first_name, v_user.locale, v_token.expires_at;
  END
  $$;

CREATE FUNCTION worker_issue_invitation_token(p_event_id uuid, p_tenant_id uuid, p_user_id uuid, p_token_hash text, p_ttl interval)
  RETURNS TABLE (out_email text, out_first_name text, out_locale text, out_tenant_name text, out_expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user users%ROWTYPE;
    v_tenant_name text;
    v_token user_tokens%ROWTYPE;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('user-token:' || p_user_id::text, 0));
    SELECT t.name INTO v_tenant_name FROM tenants t WHERE t.id = p_tenant_id AND t.status = 'ACTIVE';
    IF NOT FOUND THEN
      RETURN;
    END IF;
    SELECT u.* INTO v_user FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.tenant_id = p_tenant_id AND m.status = 'INVITED'
    WHERE u.id = p_user_id AND u.status <> 'DISABLED';
    IF NOT FOUND THEN
      RETURN;
    END IF;

    SELECT * INTO v_token FROM user_tokens WHERE source_event_id = p_event_id FOR UPDATE;
    IF FOUND THEN
      IF v_token.user_id <> p_user_id OR v_token.type <> 'INVITATION' OR v_token.invited_tenant_id IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION 'event % issued a token for another purpose', p_event_id USING ERRCODE = '42501';
      END IF;
      IF v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now() THEN
        RETURN;
      END IF;
      IF v_token.token_hash <> p_token_hash THEN
        UPDATE user_tokens SET token_hash = p_token_hash WHERE id = v_token.id;
      END IF;
      RETURN QUERY SELECT v_user.email, v_user.first_name, v_user.locale, v_tenant_name, v_token.expires_at;
      RETURN;
    END IF;

    -- A new link replaces the earlier ones of the same person in the same tenant.
    UPDATE user_tokens SET consumed_at = now()
    WHERE user_id = p_user_id AND type = 'INVITATION' AND invited_tenant_id = p_tenant_id AND consumed_at IS NULL;
    INSERT INTO user_tokens (user_id, type, token_hash, invited_tenant_id, expires_at, source_event_id)
    VALUES (p_user_id, 'INVITATION', p_token_hash, p_tenant_id, now() + p_ttl, p_event_id)
    RETURNING expires_at INTO v_token.expires_at;
    RETURN QUERY SELECT v_user.email, v_user.first_name, v_user.locale, v_tenant_name, v_token.expires_at;
  END
  $$;

ALTER FUNCTION worker_issue_password_reset_token(uuid, uuid, text, interval) OWNER TO app_platform;
ALTER FUNCTION worker_issue_invitation_token(uuid, uuid, uuid, text, interval) OWNER TO app_platform;
REVOKE ALL ON FUNCTION worker_issue_password_reset_token(uuid, uuid, text, interval), worker_issue_invitation_token(uuid, uuid, uuid, text, interval) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION worker_issue_password_reset_token(uuid, uuid, text, interval), worker_issue_invitation_token(uuid, uuid, uuid, text, interval) TO app_worker;

-- The payloads only carry ids now. Events queued by the previous version carried the clear token: they end here, and
-- the token leaves the row (the person asks again).
UPDATE platform_event_types SET description = 'Password reset e-mail; the payload carries only the user id, the worker issues the token'
WHERE type = 'email.password_reset';
UPDATE platform_event_types SET description = 'Invitation e-mail; the payload carries only the tenant and user ids, the worker issues the token'
WHERE type = 'email.invitation';
UPDATE platform_outbox_events
SET status = 'FAILED', payload = payload - 'token', last_error = 'superseded: tokens are issued by the worker'
WHERE status IN ('PENDING', 'PROCESSING') AND payload ? 'token';

-- ===========================================================================
-- 2. Tenant outbox: the worker only claims the types it has a handler for
-- ===========================================================================
DROP FUNCTION claim_outbox_events(integer, interval, integer);

-- `p_types` is explicit (NULL means every type): an event nobody can handle must stay PENDING, not burn its attempts.
CREATE FUNCTION claim_outbox_events(
  p_limit integer,
  p_types text[],
  p_lease interval DEFAULT interval '5 minutes',
  p_max_attempts integer DEFAULT 10
) RETURNS SETOF outbox_events
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE outbox_events
    SET status = 'FAILED', last_error = 'lease expired after the maximum number of attempts'
    WHERE status = 'PROCESSING' AND available_at <= now() AND attempts >= p_max_attempts
      AND (p_types IS NULL OR type = ANY (p_types));

    RETURN QUERY
    UPDATE outbox_events e
    SET status = 'PROCESSING', attempts = e.attempts + 1, available_at = now() + p_lease
    WHERE (e.tenant_id, e.id) IN (
      SELECT o.tenant_id, o.id FROM outbox_events o
      WHERE o.status IN ('PENDING', 'PROCESSING') AND o.available_at <= now() AND o.attempts < p_max_attempts
        AND (p_types IS NULL OR o.type = ANY (p_types))
      ORDER BY o.available_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e.*;
  END
  $$;

ALTER FUNCTION claim_outbox_events(integer, text[], interval, integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION claim_outbox_events(integer, text[], interval, integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION claim_outbox_events(integer, text[], interval, integer) TO app_worker;

-- ===========================================================================
-- 3. Notifications: one per person per event, and people only see their own
-- ===========================================================================
ALTER TABLE notifications ADD COLUMN source_event_id uuid;
-- Idempotency of the fan-out: processing an event twice cannot notify twice (rows without an event pass: NULLs differ).
CREATE UNIQUE INDEX notifications_tenant_id_source_event_id_user_id_key ON notifications (tenant_id, source_event_id, user_id);

-- Requests always carry a user and see only their own rows; the worker has no user and sees the tenant.
CREATE POLICY own_notifications ON notifications AS RESTRICTIVE
  USING (app_current_user() IS NULL OR user_id = app_current_user())
  WITH CHECK (app_current_user() IS NULL OR user_id = app_current_user());
CREATE POLICY own_notification_preferences ON notification_preferences AS RESTRICTIVE
  USING (app_current_user() IS NULL OR user_id = app_current_user())
  WITH CHECK (app_current_user() IS NULL OR user_id = app_current_user());

-- People only mark their notifications as read: they never edit their text nor delete them (retention does).
REVOKE UPDATE, DELETE ON notifications FROM app_runtime;
GRANT UPDATE (read_at) ON notifications TO app_runtime;
