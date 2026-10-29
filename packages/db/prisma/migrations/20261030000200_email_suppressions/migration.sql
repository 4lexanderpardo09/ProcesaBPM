-- Addresses the e-mail provider told us not to write to again (docs/base-de-datos.md §8.34): Amazon SES reports permanent
-- bounces and complaints to an SNS topic, which posts them to the API (/api/public/email-events/ses).
--
-- The table belongs to the platform and to no tenant (an address may belong to people of several organizations). Nobody
-- but the platform login touches it directly:
--   - the API (app_runtime, without a session) only calls record_email_suppression, after it verified the SNS signature;
--   - the worker only asks about one address with worker_suppressed_email before sending, and never lists them;
--   - the platform console (app_platform, BYPASSRLS) lists them and removes one (an address that works again).

SET LOCAL lock_timeout = '10s';

-- ===========================================================================
-- 1. Table
-- ===========================================================================
CREATE TYPE "email_suppression_reason" AS ENUM ('BOUNCE', 'COMPLAINT');

CREATE TABLE "email_suppressions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "reason" "email_suppression_reason" NOT NULL,
    "detail" TEXT,
    "last_feedback_id" TEXT,
    "events" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_suppressions_email_key" ON "email_suppressions"("email");

CREATE INDEX "email_suppressions_last_event_at_idx" ON "email_suppressions"("last_event_at");

-- What the provider can send, bounded: an address as the mailer compares it, short texts, a positive count.
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_email_valid
  CHECK (email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$');
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_detail_valid
  CHECK (detail IS NULL OR char_length(detail) <= 200);
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_feedback_id_valid
  CHECK (last_feedback_id IS NULL OR char_length(last_feedback_id) <= 200);
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_events_positive CHECK (events >= 1);
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_dates_ordered CHECK (last_event_at >= created_at);

-- Platform-only: the default privileges gave the table to the application roles.
REVOKE ALL ON email_suppressions FROM PUBLIC, app_runtime, app_worker;

-- ===========================================================================
-- 2. The API's door: one bounce or complaint, after the SNS signature was checked
-- ===========================================================================
-- true: recorded (new address, or a new notification about it); false: the same notification again (SNS delivers at
-- least once), nothing changes. The latest reason and detail win; `events` counts the notifications.
CREATE FUNCTION record_email_suppression(p_email text, p_reason email_suppression_reason, p_detail text, p_feedback_id text)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_email text := lower(btrim(p_email));
    v_detail text := left(nullif(btrim(p_detail), ''), 200);
    v_feedback text := left(nullif(btrim(p_feedback_id), ''), 200);
  BEGIN
    IF v_email IS NULL OR p_reason IS NULL OR char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'a suppression needs a valid address and its reason' USING ERRCODE = '22023';
    END IF;
    INSERT INTO email_suppressions AS s (email, reason, detail, last_feedback_id)
    VALUES (v_email, p_reason, v_detail, v_feedback)
    ON CONFLICT (email) DO UPDATE
      SET reason = excluded.reason, detail = excluded.detail, last_feedback_id = excluded.last_feedback_id,
          events = s.events + 1, last_event_at = now()
      WHERE s.last_feedback_id IS DISTINCT FROM excluded.last_feedback_id OR excluded.last_feedback_id IS NULL;
    RETURN FOUND;
  END
  $$;

ALTER FUNCTION record_email_suppression(text, email_suppression_reason, text, text) OWNER TO app_platform;
REVOKE ALL ON FUNCTION record_email_suppression(text, email_suppression_reason, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_email_suppression(text, email_suppression_reason, text, text) TO app_runtime;

-- ===========================================================================
-- 3. The worker's door: is this one address suppressed? (it cannot list them)
-- ===========================================================================
CREATE FUNCTION worker_suppressed_email(p_email text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM email_suppressions WHERE email = lower(btrim(p_email)))
  $$;

ALTER FUNCTION worker_suppressed_email(text) OWNER TO app_platform;
REVOKE ALL ON FUNCTION worker_suppressed_email(text) FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION worker_suppressed_email(text) TO app_worker;
