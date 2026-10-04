-- Organization data export during the deletion period (docs/base-de-datos.md §8.31).
--   * tenant_data_exports: one row per request. The API inserts fresh PENDING rows (trigger) and counts downloads; the
--     worker moves them only through the SECURITY DEFINER functions below (same protocol as the tenant purge: lease +
--     claim token + SKIP LOCKED). The zip lives at tenants/<tenant>/exports/<export>.zip (CHECK), so the tenant purge, which
--     empties the tenant's prefix, removes it too.
--   * email.data_export_ready: queued by finish_tenant_export in the same transaction that marks the export READY.
--   * claim_due_tenant_purges skips a tenant whose export holds a live lease.
-- The FKs take a SHARE ROW EXCLUSIVE lock on tenants and memberships: do not wait behind a long transaction.

SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "data_export_status" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "tenant_data_exports" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "requested_by_id" UUID NOT NULL,
    "include_files" BOOLEAN NOT NULL,
    "status" "data_export_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claim_token" UUID,
    "lease_until" TIMESTAMPTZ(3),
    "retry_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storage_key" TEXT,
    "size_bytes" BIGINT,
    "sha256" TEXT,
    "counts" JSONB,
    "error_code" TEXT,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "storage_deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenant_data_exports_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE INDEX "tenant_data_exports_tenant_id_requested_by_id_idx" ON "tenant_data_exports"("tenant_id", "requested_by_id");

-- AddForeignKey
ALTER TABLE "tenant_data_exports" ADD CONSTRAINT "tenant_data_exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_data_exports" ADD CONSTRAINT "tenant_data_exports_tenant_id_requested_by_id_fkey" FOREIGN KEY ("tenant_id", "requested_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma does not express
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_data_exports
  -- A claim exists exactly while the export runs.
  ADD CONSTRAINT data_export_claim_coherent CHECK ((status = 'RUNNING') = (claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  -- A built export has its object, size, checksum and expiry; nothing else has an object.
  ADD CONSTRAINT data_export_object_coherent CHECK (
    (status IN ('READY', 'EXPIRED')) = (storage_key IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND expires_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  -- The object is always under the tenant's own storage prefix, named after the export.
  ADD CONSTRAINT data_export_key_in_tenant CHECK (storage_key IS NULL OR storage_key = 'tenants/' || tenant_id || '/exports/' || id || '.zip'),
  ADD CONSTRAINT data_export_storage_deleted_only_expired CHECK (storage_deleted_at IS NULL OR status = 'EXPIRED'),
  -- Codes only: an error message could carry data of the tenant.
  ADD CONSTRAINT data_export_error_code_format CHECK (error_code IS NULL OR error_code ~ '^[A-Z_]{3,64}$'),
  ADD CONSTRAINT data_export_sha256_format CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT data_export_counts_object CHECK (counts IS NULL OR jsonb_typeof(counts) = 'object'),
  ADD CONSTRAINT data_export_numbers_not_negative CHECK (attempts >= 0 AND download_count >= 0 AND (size_bytes IS NULL OR size_bytes >= 0));

-- One export at a time per tenant (the API answers 409 EXPORT_IN_PROGRESS on a race).
CREATE UNIQUE INDEX tenant_data_exports_one_in_flight ON tenant_data_exports (tenant_id) WHERE status IN ('PENDING', 'RUNNING');
-- What the worker claims and what the retention expires.
CREATE INDEX tenant_data_exports_due ON tenant_data_exports (retry_at) WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX tenant_data_exports_expiring ON tenant_data_exports (expires_at) WHERE status = 'READY';
CREATE INDEX tenant_data_exports_objects_left ON tenant_data_exports (expires_at) WHERE status = 'EXPIRED' AND storage_deleted_at IS NULL;

SELECT app_enable_tenant_rls('tenant_data_exports');

-- The API (and the worker, which inherits app_runtime) inserts requests and reads them; the only update it may make is the
-- download counter. Everything else goes through the functions below.
REVOKE UPDATE, DELETE, TRUNCATE ON tenant_data_exports FROM app_runtime;
GRANT UPDATE (download_count, last_downloaded_at) ON tenant_data_exports TO app_runtime;

-- A request starts fresh: PENDING, nothing claimed, built or downloaded, dated by the database, asked by the member in
-- context, who must be an ACTIVE owner or have an active admin role, of an ACTIVE or PENDING_DELETION tenant.
CREATE FUNCTION tenant_data_export_insert_is_fresh() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.status <> 'PENDING' OR NEW.attempts <> 0 OR NEW.claim_token IS NOT NULL OR NEW.lease_until IS NOT NULL
       OR NEW.storage_key IS NOT NULL OR NEW.size_bytes IS NOT NULL OR NEW.sha256 IS NOT NULL OR NEW.counts IS NOT NULL
       OR NEW.error_code IS NOT NULL OR NEW.download_count <> 0 OR NEW.last_downloaded_at IS NOT NULL
       OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.expires_at IS NOT NULL OR NEW.storage_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'a data export starts as a fresh PENDING request' USING ERRCODE = '23514';
    END IF;
    IF NEW.requested_by_id IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'a data export is requested by the member in context' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM memberships m JOIN roles r ON r.tenant_id = m.tenant_id AND r.id = m.role_id
      WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.requested_by_id AND m.status = 'ACTIVE'
        AND (m.is_owner OR (r.is_admin AND r.is_active))
    ) THEN
      RAISE EXCEPTION 'only the owner or an administrator can export the organization' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.tenant_id AND t.status IN ('ACTIVE', 'PENDING_DELETION')) THEN
      RAISE EXCEPTION 'the organization cannot be exported in its state' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := now();
    NEW.retry_at := now();
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION tenant_data_export_insert_is_fresh() FROM PUBLIC;
CREATE TRIGGER tenant_data_export_insert_is_fresh BEFORE INSERT ON tenant_data_exports
  FOR EACH ROW EXECUTE FUNCTION tenant_data_export_insert_is_fresh();

-- A download is counted one at a time, and only for a built export that has not expired.
CREATE FUNCTION tenant_data_export_download_is_counted() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.download_count IS DISTINCT FROM OLD.download_count
       AND NOT (NEW.download_count = OLD.download_count + 1 AND OLD.status = 'READY' AND OLD.expires_at > now()) THEN
      RAISE EXCEPTION 'a download is counted once, for a READY export that has not expired' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION tenant_data_export_download_is_counted() FROM PUBLIC;
CREATE TRIGGER tenant_data_export_download_is_counted BEFORE UPDATE OF download_count ON tenant_data_exports
  FOR EACH ROW EXECUTE FUNCTION tenant_data_export_download_is_counted();

-- ---------------------------------------------------------------------------
-- The ready e-mail: a platform event that only finish_tenant_export queues
-- ---------------------------------------------------------------------------
INSERT INTO platform_event_types (type, description) VALUES
  ('email.data_export_ready', 'Tells the member who asked that the organization data export is ready; the payload carries only the tenant, export and user ids');

-- Same function as before, with one more type that only its own door may queue.
CREATE OR REPLACE FUNCTION enqueue_platform_event(p_type text, p_payload jsonb) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_event_types WHERE type = p_type) THEN
      RAISE EXCEPTION 'unknown platform event type %', p_type USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.security_notice' THEN
      RAISE EXCEPTION 'security notices are queued with enqueue_security_notice' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.data_export_ready' THEN
      RAISE EXCEPTION 'the data export e-mail is queued by finish_tenant_export' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'email.invitation' AND p_payload ->> 'tenantId' IS DISTINCT FROM app_current_tenant()::text THEN
      RAISE EXCEPTION 'an invitation can only be queued for the tenant in context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform_outbox_events (type, payload) VALUES (p_type, p_payload) RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

CREATE FUNCTION enqueue_data_export_ready(p_tenant uuid, p_export uuid, p_user uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_tenant IS NULL OR p_export IS NULL OR p_user IS NULL THEN
      RAISE EXCEPTION 'the data export e-mail needs the tenant, the export and the user' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform_outbox_events (type, payload)
    VALUES ('email.data_export_ready', jsonb_build_object('tenantId', p_tenant, 'exportId', p_export, 'userId', p_user));
  END
  $$;

-- ---------------------------------------------------------------------------
-- The worker protocol (owner app_platform, executable only by app_worker)
-- ---------------------------------------------------------------------------
-- Work is done for an ACTIVE tenant or for one pending deletion whose period is not over: once the purge is due, nothing is
-- claimed, renewed or finished (the purge waits at most one lease for a running export, see claim_due_tenant_purges).

-- Claims due exports: PENDING (or RUNNING with an expired lease) whose retry time has come, at most 3 attempts. Each claim
-- gets a fresh token that the later calls present, so a worker whose lease expired cannot touch what the new owner does.
-- A RUNNING export whose last attempt's lease expired ends FAILED (LEASE_EXPIRED). Does not skip PENDING_DELETION: that is
-- the point of the export.
CREATE FUNCTION claim_due_tenant_exports(p_limit integer, p_lease interval DEFAULT interval '30 minutes')
  RETURNS TABLE (out_tenant_id uuid, out_export_id uuid, out_include_files boolean, out_claim_token uuid, out_attempt integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_lease IS NULL OR p_lease < interval '1 minute' OR p_lease > interval '2 hours' THEN
      RAISE EXCEPTION 'the lease must be between 1 minute and 2 hours' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_data_exports x
    SET status = 'FAILED', error_code = 'LEASE_EXPIRED', claim_token = NULL, lease_until = NULL, completed_at = now()
    WHERE x.status = 'RUNNING' AND x.lease_until <= now() AND x.attempts >= 3;

    RETURN QUERY
    WITH due AS (
      SELECT d.tenant_id, d.id FROM tenant_data_exports d
      WHERE (d.status = 'PENDING' OR (d.status = 'RUNNING' AND d.lease_until <= now()))
        AND d.retry_at <= now() AND d.attempts < 3
        AND EXISTS (
          SELECT 1 FROM tenants t
          WHERE t.id = d.tenant_id AND (t.status = 'ACTIVE' OR (t.status = 'PENDING_DELETION' AND t.purge_after > now()))
        )
      ORDER BY d.retry_at, d.id
      LIMIT least(greatest(coalesce(p_limit, 1), 1), 10)
      FOR UPDATE OF d SKIP LOCKED
    )
    UPDATE tenant_data_exports x
    SET status = 'RUNNING', attempts = x.attempts + 1, claim_token = gen_random_uuid(), lease_until = now() + p_lease,
        started_at = coalesce(x.started_at, now())
    FROM due
    WHERE x.tenant_id = due.tenant_id AND x.id = due.id
    RETURNING x.tenant_id, x.id, x.include_files, x.claim_token, x.attempts;
  END
  $$;

-- The heartbeat. false: the claim is not ours any more (or the purge is due): stop and clean up.
CREATE FUNCTION renew_tenant_export_lease(p_tenant uuid, p_id uuid, p_token uuid, p_lease interval DEFAULT interval '30 minutes') RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_lease IS NULL OR p_lease < interval '1 minute' OR p_lease > interval '2 hours' THEN
      RAISE EXCEPTION 'the lease must be between 1 minute and 2 hours' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_data_exports x SET lease_until = now() + p_lease
    FROM tenants t
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token
      AND t.id = x.tenant_id AND (t.status = 'ACTIVE' OR (t.status = 'PENDING_DELETION' AND t.purge_after > now()));
    RETURN FOUND;
  END
  $$;

-- The object is written: READY, with its size, checksum and per-dataset counts. It expires 7 days later, never after the
-- purge. The e-mail to the member who asked is queued in the same transaction. false: not ours any more (or the purge is
-- due): the worker deletes the object it wrote.
CREATE FUNCTION finish_tenant_export(p_tenant uuid, p_id uuid, p_token uuid, p_size bigint, p_sha256 text, p_counts jsonb) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_requested_by uuid;
  BEGIN
    IF p_size IS NULL OR p_size < 0 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_counts IS NULL OR jsonb_typeof(p_counts) <> 'object' THEN
      RAISE EXCEPTION 'a finished export needs its size, a sha256 in hex and the counts object' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_data_exports x
    SET status = 'READY', claim_token = NULL, lease_until = NULL, error_code = NULL,
        storage_key = 'tenants/' || x.tenant_id || '/exports/' || x.id || '.zip',
        size_bytes = p_size, sha256 = p_sha256, counts = p_counts, completed_at = now(),
        expires_at = least(now() + interval '7 days', coalesce(t.purge_after, 'infinity'::timestamptz))
    FROM tenants t
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token
      AND t.id = x.tenant_id AND (t.status = 'ACTIVE' OR (t.status = 'PENDING_DELETION' AND t.purge_after > now()))
    RETURNING x.requested_by_id INTO v_requested_by;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    PERFORM enqueue_data_export_ready(p_tenant, p_id, v_requested_by);
    RETURN true;
  END
  $$;

-- An attempt failed (codes only). With a retry time and attempts left it goes back to PENDING; otherwise FAILED for good.
CREATE FUNCTION fail_tenant_export(p_tenant uuid, p_id uuid, p_token uuid, p_error_code text, p_retry_at timestamptz) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_error_code IS NULL THEN
      RAISE EXCEPTION 'a failed export needs its error code' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_data_exports x
    SET status = CASE WHEN p_retry_at IS NULL OR x.attempts >= 3 THEN 'FAILED'::data_export_status ELSE 'PENDING'::data_export_status END,
        retry_at = CASE WHEN p_retry_at IS NULL OR x.attempts >= 3 THEN x.retry_at ELSE greatest(p_retry_at, now()) END,
        completed_at = CASE WHEN p_retry_at IS NULL OR x.attempts >= 3 THEN now() ELSE NULL END,
        claim_token = NULL, lease_until = NULL, error_code = p_error_code
    WHERE x.tenant_id = p_tenant AND x.id = p_id AND x.status = 'RUNNING' AND x.claim_token = p_token;
    RETURN FOUND;
  END
  $$;

-- What the ready e-mail needs, read by the worker: only while the export is READY and not expired, the member who asked
-- is still an ACTIVE owner or active admin with an ACTIVE account, and the tenant is ACTIVE or pending deletion.
CREATE FUNCTION worker_data_export_notice(p_tenant uuid, p_export uuid, p_user uuid)
  RETURNS TABLE (out_email text, out_first_name text, out_locale text, out_time_zone text, out_tenant_name text, out_expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u.email, u.first_name, u.locale, u.time_zone, t.name, x.expires_at
    FROM tenant_data_exports x
    JOIN tenants t ON t.id = x.tenant_id
    JOIN memberships m ON m.tenant_id = x.tenant_id AND m.user_id = x.requested_by_id
    JOIN roles r ON r.tenant_id = m.tenant_id AND r.id = m.role_id
    JOIN users u ON u.id = m.user_id
    WHERE x.tenant_id = p_tenant AND x.id = p_export AND x.requested_by_id = p_user
      AND x.status = 'READY' AND x.expires_at > now()
      AND m.status = 'ACTIVE' AND (m.is_owner OR (r.is_admin AND r.is_active)) AND u.status = 'ACTIVE'
      AND t.status IN ('ACTIVE', 'PENDING_DELETION')
  $$;

-- Retention step: the objects to delete. First the expired exports whose object an earlier run could not delete, then up
-- to the batch the READY exports past their expiry, which become EXPIRED here. The worker deletes each object after the
-- commit and marks it with retention_mark_export_object_deleted; a failed delete is returned again by the next call.
-- A concurrent call returns nothing (advisory lock), like the other retention steps.
CREATE FUNCTION retention_expire_tenant_exports(p_limit integer)
  RETURNS TABLE (out_tenant_id uuid, out_export_id uuid, out_storage_key text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_limit integer := retention_batch_limit(p_limit);
    v_left integer;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('retention:tenant_data_exports')) THEN
      RETURN;
    END IF;
    RETURN QUERY
      SELECT x.tenant_id, x.id, x.storage_key FROM tenant_data_exports x
      WHERE x.status = 'EXPIRED' AND x.storage_deleted_at IS NULL
      ORDER BY x.expires_at, x.id LIMIT v_limit;
    GET DIAGNOSTICS v_left = ROW_COUNT;
    IF v_left >= v_limit THEN
      RETURN;
    END IF;
    RETURN QUERY
      WITH due AS (
        SELECT d.tenant_id, d.id FROM tenant_data_exports d
        WHERE d.status = 'READY' AND d.expires_at <= now()
        ORDER BY d.expires_at, d.id LIMIT v_limit - v_left
        FOR UPDATE SKIP LOCKED
      )
      UPDATE tenant_data_exports x SET status = 'EXPIRED'
      FROM due WHERE x.tenant_id = due.tenant_id AND x.id = due.id
      RETURNING x.tenant_id, x.id, x.storage_key;
  END
  $$;

CREATE FUNCTION retention_mark_export_object_deleted(p_tenant uuid, p_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE tenant_data_exports SET storage_deleted_at = now()
    WHERE tenant_id = p_tenant AND id = p_id AND status = 'EXPIRED' AND storage_deleted_at IS NULL;
    RETURN FOUND;
  END
  $$;

-- ---------------------------------------------------------------------------
-- The purge waits for a running export: same function as before, with one more condition. The export stops renewing once
-- the purge is due, so the wait is at most one lease (30 minutes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_tenant_purges(p_limit integer, p_lease interval DEFAULT interval '30 minutes')
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
        AND NOT EXISTS (
          SELECT 1 FROM tenant_data_exports x WHERE x.tenant_id = d.id AND x.status = 'RUNNING' AND x.lease_until > now()
        )
      ORDER BY d.purge_after, d.id
      LIMIT least(greatest(p_limit, 1), 100)
      FOR UPDATE SKIP LOCKED
    )
    RETURNING t.id, t.purge_attempts
  $$;

ALTER FUNCTION enqueue_data_export_ready(uuid, uuid, uuid) OWNER TO app_outbox_owner;
ALTER FUNCTION claim_due_tenant_exports(integer, interval) OWNER TO app_platform;
ALTER FUNCTION renew_tenant_export_lease(uuid, uuid, uuid, interval) OWNER TO app_platform;
ALTER FUNCTION finish_tenant_export(uuid, uuid, uuid, bigint, text, jsonb) OWNER TO app_platform;
ALTER FUNCTION fail_tenant_export(uuid, uuid, uuid, text, timestamptz) OWNER TO app_platform;
ALTER FUNCTION worker_data_export_notice(uuid, uuid, uuid) OWNER TO app_platform;
ALTER FUNCTION retention_expire_tenant_exports(integer) OWNER TO app_platform;
ALTER FUNCTION retention_mark_export_object_deleted(uuid, uuid) OWNER TO app_platform;

REVOKE ALL ON FUNCTION enqueue_data_export_ready(uuid, uuid, uuid) FROM PUBLIC, app_runtime;
-- Only the worker runs the protocol; app_platform (whose login the API holds) does not, even on the functions it owns.
REVOKE ALL ON FUNCTION
  claim_due_tenant_exports(integer, interval), renew_tenant_export_lease(uuid, uuid, uuid, interval),
  finish_tenant_export(uuid, uuid, uuid, bigint, text, jsonb), fail_tenant_export(uuid, uuid, uuid, text, timestamptz),
  worker_data_export_notice(uuid, uuid, uuid), retention_expire_tenant_exports(integer), retention_mark_export_object_deleted(uuid, uuid)
  FROM PUBLIC, app_runtime, app_platform;
GRANT EXECUTE ON FUNCTION enqueue_data_export_ready(uuid, uuid, uuid) TO app_platform;
GRANT EXECUTE ON FUNCTION
  claim_due_tenant_exports(integer, interval), renew_tenant_export_lease(uuid, uuid, uuid, interval),
  finish_tenant_export(uuid, uuid, uuid, bigint, text, jsonb), fail_tenant_export(uuid, uuid, uuid, text, timestamptz),
  worker_data_export_notice(uuid, uuid, uuid), retention_expire_tenant_exports(integer), retention_mark_export_object_deleted(uuid, uuid)
  TO app_worker;
