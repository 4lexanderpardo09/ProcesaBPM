-- Deleting a tenant: the platform asks (PENDING_DELETION, 30 days), the tenant is locked out, and after the period the
-- worker removes its files and then its data (see claim_due_tenant_purges, finish_tenant_purge). The tenants row stays
-- as a tombstone (PURGED): its slug is not reused and the platform audit log keeps a subject to point at.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "deletion_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "deletion_requested_by_id" UUID,
ADD COLUMN     "purge_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purge_last_error" TEXT,
ADD COLUMN     "purge_lease_until" TIMESTAMPTZ(3),
ADD COLUMN     "purge_retry_at" TIMESTAMPTZ(3),
ADD COLUMN     "purged_at" TIMESTAMPTZ(3);


-- ===========================================================================
-- Rules
-- ===========================================================================
ALTER TABLE tenants ADD CONSTRAINT tenants_deletion_is_coherent CHECK (
  (status = 'PENDING_DELETION') = (purge_after IS NOT NULL)
  AND (status = 'PURGED') = (purged_at IS NOT NULL)
  AND (status IN ('PENDING_DELETION', 'PURGED')) = (deletion_requested_at IS NOT NULL AND deletion_requested_by_id IS NOT NULL)
);

-- The purge worker looks for due tenants: keep that query off the whole table.
CREATE INDEX tenants_purge_due ON tenants (purge_after) WHERE status = 'PENDING_DELETION';

-- The type of the e-mail that tells the owner (the worker reads the address itself: the payload only carries ids).
INSERT INTO platform_event_types (type, description) VALUES
  ('email.tenant_deletion_requested', 'Tells the owner that the deletion of the organization was requested and when it becomes final; the payload carries only the tenant and user ids');

-- The login still lists an organization that is pending deletion, so that choosing it answers 403 TENANT_PENDING_DELETION
-- (the person learns why) instead of the organization silently disappearing.
CREATE OR REPLACE FUNCTION auth_list_memberships(p_user_id uuid)
  RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text, membership_status membership_status, tenant_mfa_required boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name, m.status, t.mfa_required
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id
      AND p_user_id = app_current_user()
      AND t.status IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION')
      AND m.status <> 'INACTIVE'
  $$;

-- ===========================================================================
-- The purge, one claim at a time (same protocol as the outbox: lease + attempt token + SKIP LOCKED)
-- ===========================================================================
-- Claims due tenants (the period is over, no live lease, not waiting out a retry). The attempt number is the token that
-- the later calls must present, so a worker whose lease expired cannot finish or fail what the new owner is doing.
CREATE FUNCTION claim_due_tenant_purges(p_limit integer, p_lease interval DEFAULT interval '30 minutes')
  RETURNS TABLE (out_tenant_id uuid, out_attempt integer)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE tenants t
    SET purge_lease_until = now() + p_lease, purge_attempts = t.purge_attempts + 1
    WHERE t.id IN (
      SELECT d.id FROM tenants d
      WHERE d.status = 'PENDING_DELETION' AND d.purge_after <= now()
        AND (d.purge_lease_until IS NULL OR d.purge_lease_until <= now())
        AND (d.purge_retry_at IS NULL OR d.purge_retry_at <= now())
      ORDER BY d.purge_after, d.id
      LIMIT least(greatest(p_limit, 1), 100)
      FOR UPDATE SKIP LOCKED
    )
    RETURNING t.id, t.purge_attempts
  $$;

-- A step failed: release the lease and say when to try again.
CREATE FUNCTION fail_tenant_purge(p_tenant uuid, p_attempt integer, p_error text, p_retry_at timestamptz) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE tenants
      SET purge_lease_until = NULL, purge_retry_at = p_retry_at, purge_last_error = left(p_error, 2000)
      WHERE id = p_tenant AND status = 'PENDING_DELETION' AND purge_attempts = p_attempt
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;

-- The last step, after the files are gone: removes the tenant's data (purge_tenant) and leaves the tombstone, in one
-- transaction. Returns false when there is nothing to do (not due, not pending, or someone else holds the claim), so a
-- repeated call is harmless and PURGED is never processed again.
CREATE FUNCTION finish_tenant_purge(p_tenant uuid, p_attempt integer) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  SET statement_timeout = '30min'
  AS $$
  DECLARE
    v tenants%ROWTYPE;
  BEGIN
    SELECT * INTO v FROM tenants
    WHERE id = p_tenant AND status = 'PENDING_DELETION' AND purge_after <= now() AND purge_attempts = p_attempt
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;

    PERFORM purge_tenant(p_tenant);
    INSERT INTO tenants (id, slug, name, status, plan_id, country_code, time_zone, created_at, deletion_requested_at, deletion_requested_by_id, purged_at)
    VALUES (v.id, v.slug, v.name, 'PURGED', v.plan_id, v.country_code, v.time_zone, v.created_at, v.deletion_requested_at, v.deletion_requested_by_id, now());
    INSERT INTO platform_audit_logs (actor_user_id, action, target_tenant_id, data)
    VALUES (v.deletion_requested_by_id, 'tenant.purged', v.id, jsonb_build_object('slug', v.slug, 'name', v.name, 'requestedAt', v.deletion_requested_at));
    RETURN true;
  END
  $$;

-- What the owner's e-mail needs, read by the worker (it cannot read users or tenants of other tenants itself). Empty
-- unless the tenant is pending deletion and the user is its active owner.
CREATE FUNCTION worker_tenant_deletion_notice(p_tenant uuid, p_user uuid)
  RETURNS TABLE (out_email text, out_first_name text, out_locale text, out_tenant_name text, out_purge_after timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u.email, u.first_name, u.locale, t.name, t.purge_after
    FROM tenants t
    JOIN memberships m ON m.tenant_id = t.id AND m.user_id = p_user AND m.is_owner
    JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
    WHERE t.id = p_tenant AND t.status = 'PENDING_DELETION'
  $$;

ALTER FUNCTION claim_due_tenant_purges(integer, interval) OWNER TO app_platform;
ALTER FUNCTION fail_tenant_purge(uuid, integer, text, timestamptz) OWNER TO app_platform;
ALTER FUNCTION finish_tenant_purge(uuid, integer) OWNER TO app_platform;
ALTER FUNCTION worker_tenant_deletion_notice(uuid, uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION
  claim_due_tenant_purges(integer, interval), fail_tenant_purge(uuid, integer, text, timestamptz),
  finish_tenant_purge(uuid, integer), worker_tenant_deletion_notice(uuid, uuid)
  FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION
  claim_due_tenant_purges(integer, interval), fail_tenant_purge(uuid, integer, text, timestamptz),
  finish_tenant_purge(uuid, integer), worker_tenant_deletion_notice(uuid, uuid)
  TO app_worker;
