-- Support access (v1, read-only): a tenant administrator lets platform support read the tenant's data for a limited
-- time. The grant belongs to the tenant (RLS); the visits (support_sessions) are opened only by a platform function that
-- checks the grant, and every request of a visit is audited in the tenant's own audit_logs (support_actor_id /
-- support_grant_id; actor_id stays empty because a platform administrator is not a member).

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "support_actor_id" UUID,
ADD COLUMN     "support_grant_id" UUID;

-- CreateTable
CREATE TABLE "support_access_grants" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "granted_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "support_sessions" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "grant_id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "platform_user_label" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE INDEX "support_access_grants_tenant_id_created_at_idx" ON "support_access_grants"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_access_grants_tenant_id_granted_by_id_idx" ON "support_access_grants"("tenant_id", "granted_by_id");

-- CreateIndex
CREATE INDEX "support_access_grants_tenant_id_revoked_by_id_idx" ON "support_access_grants"("tenant_id", "revoked_by_id");

-- CreateIndex
CREATE INDEX "support_sessions_tenant_id_grant_id_idx" ON "support_sessions"("tenant_id", "grant_id");

-- CreateIndex
CREATE INDEX "support_sessions_platform_user_id_idx" ON "support_sessions"("platform_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_support_actor_id_idx" ON "audit_logs"("support_actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_support_grant_id_idx" ON "audit_logs"("tenant_id", "support_grant_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_support_actor_id_fkey" FOREIGN KEY ("support_actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_support_grant_id_fkey" FOREIGN KEY ("tenant_id", "support_grant_id") REFERENCES "support_access_grants"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_tenant_id_granted_by_id_fkey" FOREIGN KEY ("tenant_id", "granted_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_tenant_id_revoked_by_id_fkey" FOREIGN KEY ("tenant_id", "revoked_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_tenant_id_grant_id_fkey" FOREIGN KEY ("tenant_id", "grant_id") REFERENCES "support_access_grants"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ===========================================================================
-- Rules the schema cannot express
-- ===========================================================================
ALTER TABLE support_access_grants
  ADD CONSTRAINT support_access_grants_reason_length CHECK (length(reason) BETWEEN 3 AND 500),
  ADD CONSTRAINT support_access_grants_window CHECK (expires_at > starts_at AND expires_at <= starts_at + interval '72 hours'),
  ADD CONSTRAINT support_access_grants_revoker_needs_revocation CHECK (revoked_by_id IS NULL OR revoked_at IS NOT NULL);

-- One grant in force per tenant (not revoked; an expired one still counts until it is revoked, which granting again does).
CREATE UNIQUE INDEX support_access_grants_one_in_force ON support_access_grants (tenant_id) WHERE revoked_at IS NULL;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_support_columns_together CHECK ((support_actor_id IS NULL) = (support_grant_id IS NULL)),
  ADD CONSTRAINT audit_logs_support_has_no_member_actor CHECK (support_actor_id IS NULL OR actor_id IS NULL);

SELECT app_enable_tenant_rls('support_access_grants');
SELECT app_enable_tenant_rls('support_sessions');

-- History does not change: a visit only gets closed once, and a revoked grant stays as it was revoked (the privileges
-- already limit which columns can be written; this keeps those columns from being rewritten).
CREATE FUNCTION support_history_is_final() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_TABLE_NAME = 'support_sessions' THEN
      IF NEW.platform_user_label IS DISTINCT FROM OLD.platform_user_label OR NEW.platform_user_id IS DISTINCT FROM OLD.platform_user_id
         OR NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
         OR (OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
        RAISE EXCEPTION 'a support session can only be closed, once' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by_id IS DISTINCT FROM OLD.revoked_by_id) THEN
      RAISE EXCEPTION 'a revoked support grant cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER support_sessions_final BEFORE UPDATE ON support_sessions FOR EACH ROW EXECUTE FUNCTION support_history_is_final();
CREATE TRIGGER support_access_grants_final BEFORE UPDATE ON support_access_grants FOR EACH ROW EXECUTE FUNCTION support_history_is_final();

-- ===========================================================================
-- Privileges: the tenant can create and revoke grants and see its visits; it can close a visit but never open one
-- (app_worker mirrors app_runtime on tables, by convention).
-- ===========================================================================
REVOKE ALL ON support_access_grants, support_sessions FROM PUBLIC, app_runtime, app_worker;
GRANT SELECT, INSERT ON support_access_grants TO app_runtime, app_worker;
GRANT UPDATE (revoked_at, revoked_by_id) ON support_access_grants TO app_runtime, app_worker;
GRANT SELECT ON support_sessions TO app_runtime, app_worker;
GRANT UPDATE (closed_at) ON support_sessions TO app_runtime, app_worker;
-- Grants and visits are history: the platform login cannot rewrite them either. It may revoke a grant (when a tenant is
-- suspended or deleted) and close a visit; row locks (FOR SHARE) also need an UPDATE privilege, and these columns give it.
REVOKE DELETE, TRUNCATE ON support_access_grants, support_sessions FROM app_platform;
REVOKE UPDATE ON support_access_grants, support_sessions FROM app_platform;
GRANT UPDATE (revoked_at, revoked_by_id) ON support_access_grants TO app_platform;
GRANT UPDATE (closed_at) ON support_sessions TO app_platform;

-- ===========================================================================
-- Opening a visit (platform) and checking it on every request (API)
-- ===========================================================================
-- Returns no row when the tenant has no grant in force. FOR SHARE: a revocation in flight is waited for, so a visit is
-- never opened under a grant that was just revoked.
CREATE FUNCTION platform_open_support_session(p_tenant uuid, p_admin uuid)
  RETURNS TABLE (out_grant_id uuid, out_session_id uuid, out_expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_grant support_access_grants%ROWTYPE;
    v_session uuid;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id WHERE pa.user_id = p_admin AND u.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'only an active platform admin opens a support session' USING ERRCODE = '42501';
    END IF;

    SELECT g.* INTO v_grant
    FROM support_access_grants g JOIN tenants t ON t.id = g.tenant_id
    WHERE g.tenant_id = p_tenant AND g.revoked_at IS NULL AND g.starts_at <= now() AND g.expires_at > now()
      AND t.status IN ('ACTIVE', 'SUSPENDED')
    FOR SHARE OF g;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    INSERT INTO support_sessions (tenant_id, grant_id, platform_user_id, platform_user_label)
    SELECT p_tenant, v_grant.id, u.id, left(u.first_name || ' ' || u.last_name, 200) FROM users u WHERE u.id = p_admin
    RETURNING id INTO v_session;
    RETURN QUERY SELECT v_grant.id, v_session, v_grant.expires_at;
  END
  $$;

-- The per-request check of a support token. A visit that is no longer valid (grant revoked or expired, admin removed,
-- tenant gone) is closed here, and the caller answers 401. The parameters come from a signed token.
CREATE FUNCTION auth_verify_support_session(p_tenant uuid, p_session uuid, p_grant uuid, p_admin uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_valid boolean;
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM support_sessions s
      JOIN support_access_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
      JOIN platform_admins pa ON pa.user_id = s.platform_user_id
      JOIN users u ON u.id = s.platform_user_id AND u.status = 'ACTIVE'
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.tenant_id = p_tenant AND s.id = p_session AND s.grant_id = p_grant AND s.platform_user_id = p_admin
        AND s.closed_at IS NULL AND g.revoked_at IS NULL AND g.starts_at <= now() AND g.expires_at > now()
        AND t.status IN ('ACTIVE', 'SUSPENDED')
    ) INTO v_valid;
    IF NOT v_valid THEN
      UPDATE support_sessions SET closed_at = now() WHERE tenant_id = p_tenant AND id = p_session AND closed_at IS NULL;
    END IF;
    RETURN v_valid;
  END
  $$;

ALTER FUNCTION platform_open_support_session(uuid, uuid) OWNER TO app_platform;
ALTER FUNCTION auth_verify_support_session(uuid, uuid, uuid, uuid) OWNER TO app_platform;
REVOKE ALL ON FUNCTION platform_open_support_session(uuid, uuid), auth_verify_support_session(uuid, uuid, uuid, uuid) FROM PUBLIC, app_runtime, app_worker;
GRANT EXECUTE ON FUNCTION platform_open_support_session(uuid, uuid) TO app_platform;
GRANT EXECUTE ON FUNCTION auth_verify_support_session(uuid, uuid, uuid, uuid) TO app_runtime;
