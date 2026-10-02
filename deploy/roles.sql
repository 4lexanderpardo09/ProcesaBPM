-- Login roles of the three entry points (docs/despliegue.md §3). Run it once after the migrations, as an administrator
-- of the database, and again whenever a password changes: it is idempotent.
--
--   API_DB_PASSWORD=… WORKER_DB_PASSWORD=… PLATFORM_DB_PASSWORD=… psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f deploy/roles.sql
--
-- The passwords are read from the environment (psql 15+), so they do not appear in the process list or in `docker inspect`;
-- and statement logging is switched off for the session (needs a superuser, as the schema owner is) because ALTER ROLE
-- ... PASSWORD would otherwise write them to the server log when log_statement is ddl or all.
--
-- BYPASSRLS is not inherited by membership: every login must run as its role, hence `ALTER ROLE … SET role`.
\set ON_ERROR_STOP on
\getenv api_password API_DB_PASSWORD
\getenv worker_password WORKER_DB_PASSWORD
\getenv platform_password PLATFORM_DB_PASSWORD
SET log_statement = 'none';

SELECT format('CREATE ROLE %I LOGIN IN ROLE app_runtime', 'procesabpm_api') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procesabpm_api') \gexec
SELECT format('CREATE ROLE %I LOGIN IN ROLE app_worker', 'procesabpm_worker') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procesabpm_worker') \gexec
SELECT format('CREATE ROLE %I LOGIN IN ROLE app_platform', 'procesabpm_platform') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procesabpm_platform') \gexec

-- A role created by hand or by an earlier failed attempt is repaired too.
ALTER ROLE procesabpm_api LOGIN;
GRANT app_runtime TO procesabpm_api;
ALTER ROLE procesabpm_worker LOGIN;
GRANT app_worker TO procesabpm_worker;
ALTER ROLE procesabpm_platform LOGIN;
GRANT app_platform TO procesabpm_platform;

ALTER ROLE procesabpm_api PASSWORD :'api_password';
ALTER ROLE procesabpm_api SET role = 'app_runtime';
ALTER ROLE procesabpm_worker PASSWORD :'worker_password';
ALTER ROLE procesabpm_worker SET role = 'app_worker';
ALTER ROLE procesabpm_platform PASSWORD :'platform_password';
ALTER ROLE procesabpm_platform SET role = 'app_platform';
