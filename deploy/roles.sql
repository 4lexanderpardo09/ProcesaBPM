-- Login roles of the three entry points (docs/despliegue.md §3). Run it once after the migrations, as an administrator
-- of the database, and again whenever a password changes: it is idempotent.
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
--        -v api_password="$API_DB_PASSWORD" -v worker_password="$WORKER_DB_PASSWORD" -v platform_password="$PLATFORM_DB_PASSWORD" \
--        -f deploy/roles.sql
--
-- BYPASSRLS is not inherited by membership: every login must run as its role, hence `ALTER ROLE … SET role`.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE %I LOGIN IN ROLE app_runtime', 'procesabpm_api') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procesabpm_api') \gexec
SELECT format('CREATE ROLE %I LOGIN IN ROLE app_worker', 'procesabpm_worker') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procesabpm_worker') \gexec
SELECT format('CREATE ROLE %I LOGIN IN ROLE app_platform', 'procesabpm_platform') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procesabpm_platform') \gexec

ALTER ROLE procesabpm_api PASSWORD :'api_password';
ALTER ROLE procesabpm_api SET role = 'app_runtime';
ALTER ROLE procesabpm_worker PASSWORD :'worker_password';
ALTER ROLE procesabpm_worker SET role = 'app_worker';
ALTER ROLE procesabpm_platform PASSWORD :'platform_password';
ALTER ROLE procesabpm_platform SET role = 'app_platform';
