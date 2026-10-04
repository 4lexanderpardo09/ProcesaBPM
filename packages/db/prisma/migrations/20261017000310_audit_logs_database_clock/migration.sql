-- The tenant trail is dated by the database clock (docs/base-de-datos.md §8.21), like platform_audit_logs
-- (platform_audit_logs_database_clock, 20261017000100): whoever inserts (app_runtime, app_worker or app_platform, which writes
-- support and MFA reset rows) cannot backdate a row into the purge window or date one in the future.
-- Its own migration: CREATE TRIGGER takes a lock on audit_logs, which must not be waited for while another migration holds a
-- lock on users.
-- Moving a tenant: INSERT … SELECT or COPY into audit_logs re-dates every row; use pg_restore or logical replication.

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION audit_logs_database_clock() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    NEW.created_at := now();
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION audit_logs_database_clock() FROM PUBLIC;
DROP TRIGGER IF EXISTS audit_logs_database_clock ON audit_logs;
CREATE TRIGGER audit_logs_database_clock BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_database_clock();
