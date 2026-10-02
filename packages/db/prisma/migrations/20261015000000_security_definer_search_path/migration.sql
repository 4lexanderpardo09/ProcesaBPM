-- Every SECURITY DEFINER function runs with search_path = public, pg_temp, so a temporary table
-- can never shadow a real one. ALTER FUNCTION needs the exact signature (overloads); a wrong one
-- fails the migration loudly.
ALTER FUNCTION auth_find_user_by_email(text)          SET search_path = public, pg_temp;
ALTER FUNCTION auth_find_refresh_session(text)        SET search_path = public, pg_temp;
ALTER FUNCTION auth_find_user_token(text)             SET search_path = public, pg_temp;
ALTER FUNCTION auth_list_memberships(uuid)            SET search_path = public, pg_temp;
ALTER FUNCTION invite_user(text, text, text)          SET search_path = public, pg_temp;
ALTER FUNCTION auth_consume_user_token(text, text)    SET search_path = public, pg_temp;
ALTER FUNCTION auth_register_login_attempt(uuid, boolean, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION auth_set_own_password(text)            SET search_path = public, pg_temp;
ALTER FUNCTION auth_get_own_mfa_secret()              SET search_path = public, pg_temp;
ALTER FUNCTION auth_set_own_mfa(bytea, boolean)       SET search_path = public, pg_temp;
ALTER FUNCTION purge_tenant(uuid)                     SET search_path = public, pg_temp;
ALTER FUNCTION purge_processed_outbox_events(interval) SET search_path = public, pg_temp;
ALTER FUNCTION purge_read_notifications(interval)     SET search_path = public, pg_temp;

-- Fails the migration if any SECURITY DEFINER function in public still lacks it (e.g. an unlisted overload).
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO missing
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND NOT coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER functions without search_path public, pg_temp: %', missing;
  END IF;
END $$;
