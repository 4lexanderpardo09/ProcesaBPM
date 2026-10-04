-- Announcements that block sign-in (docs/base-de-datos.md §8.30).
--   * audience: ALL (every tenant, the default and what existed before) or TENANTS (the rows of platform_announcement_tenants).
--     It lives on the announcement because a member only sees their own tenant's target rows (RLS) and could not tell
--     "no targets" from "targets elsewhere".
--   * auth_login_blocks(): the blocking announcements in force now or starting within 24 hours, for the API's 30 s cache
--     (login blocks and the public sign-in banner).
-- The FK to tenants takes a SHARE ROW EXCLUSIVE lock on it: do not wait behind a long transaction.

SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "announcement_audience" AS ENUM ('ALL', 'TENANTS');

-- AlterTable
ALTER TABLE "platform_announcements" ADD COLUMN     "audience" "announcement_audience" NOT NULL DEFAULT 'ALL';

-- CreateTable
CREATE TABLE "platform_announcement_tenants" (
    "tenant_id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,

    CONSTRAINT "platform_announcement_tenants_pkey" PRIMARY KEY ("tenant_id","announcement_id")
);

-- CreateIndex
CREATE INDEX "platform_announcement_tenants_announcement_id_idx" ON "platform_announcement_tenants"("announcement_id");

-- AddForeignKey
ALTER TABLE "platform_announcement_tenants" ADD CONSTRAINT "platform_announcement_tenants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_announcement_tenants" ADD CONSTRAINT "platform_announcement_tenants_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "platform_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma does not express
-- ---------------------------------------------------------------------------
-- The API already refused an end before the start; now the database does too (the cache relies on it).
ALTER TABLE platform_announcements ADD CONSTRAINT platform_announcements_window CHECK (ends_at IS NULL OR ends_at > starts_at);
CREATE INDEX platform_announcements_blocking ON platform_announcements (starts_at) WHERE blocks_login;

SELECT app_enable_tenant_rls('platform_announcement_tenants');
-- Members read their own tenant's rows (RLS); only the platform writes them. app_worker inherits app_runtime.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform_announcement_tenants FROM app_runtime, app_worker;

-- A TENANTS announcement needs at least one tenant, checked at COMMIT so the API can replace the targets in one
-- transaction. A tenant that is purged takes its target rows with it: an announcement left without tenants reaches
-- nobody, which is harmless, so that case is let through instead of making the purge fail. finish_tenant_purge re-inserts
-- the tenant as a PURGED tombstone (same id) in the same transaction, so a PURGED row counts as gone (the same rule as
-- assert_tenant_keeps_admin).
CREATE FUNCTION announcement_audience_has_targets() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_announcement_id uuid;
  BEGIN
    IF TG_TABLE_NAME = 'platform_announcements' THEN
      v_announcement_id := NEW.id;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id AND status <> 'PURGED') THEN
        RETURN NULL;
      END IF;
      v_announcement_id := OLD.announcement_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM platform_announcements a
      WHERE a.id = v_announcement_id AND a.audience = 'TENANTS'
        AND NOT EXISTS (SELECT 1 FROM platform_announcement_tenants t WHERE t.announcement_id = a.id)
    ) THEN
      RAISE EXCEPTION 'a TENANTS announcement needs at least one tenant' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION announcement_audience_has_targets() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER announcement_audience_has_targets AFTER INSERT OR UPDATE OF audience ON platform_announcements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION announcement_audience_has_targets();
CREATE CONSTRAINT TRIGGER announcement_audience_has_targets AFTER DELETE OR UPDATE ON platform_announcement_tenants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION announcement_audience_has_targets();

-- ---------------------------------------------------------------------------
-- auth_login_blocks(): what the API caches (one call per 30 s per instance, none per request)
-- ---------------------------------------------------------------------------
-- Blocking announcements in force now or starting within 24 hours, with their type and audience. The API evaluates the
-- window against its own clock on every request, so start and end take effect on time without a new query, and serves the
-- public sign-in banner from the same rows. It returns the target tenants of every announcement (app_runtime cannot read
-- other tenants' rows): the API never sends them to a client. At most 200 rows: the ones for every tenant first (a new
-- global block must never be the one cut off), then the earliest; the API logs when the cap is reached.
CREATE FUNCTION auth_login_blocks()
  RETURNS TABLE (out_id uuid, out_type announcement_type, out_title text, out_body text, out_starts_at timestamptz,
                 out_ends_at timestamptz, out_all_tenants boolean, out_tenant_ids uuid[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT a.id, a.type, a.title, a.body, a.starts_at, a.ends_at, a.audience = 'ALL',
           coalesce(array_agg(t.tenant_id ORDER BY t.tenant_id) FILTER (WHERE t.tenant_id IS NOT NULL), '{}')
    FROM platform_announcements a
    LEFT JOIN platform_announcement_tenants t ON t.announcement_id = a.id
    WHERE a.blocks_login
      AND a.starts_at <= now() + interval '24 hours'
      AND (a.ends_at IS NULL OR a.ends_at > now())
    GROUP BY a.id
    ORDER BY a.audience = 'ALL' DESC, a.starts_at, a.id
    LIMIT 200
  $$;
ALTER FUNCTION auth_login_blocks() OWNER TO app_platform;
REVOKE ALL ON FUNCTION auth_login_blocks() FROM PUBLIC;
-- app_worker inherits the grant: harmless, the function returns no secrets (like the other auth_* functions).
GRANT EXECUTE ON FUNCTION auth_login_blocks() TO app_runtime;
