-- 1. Amount rules point at steps of THEIR OWN version: the foreign keys now include version_id.
-- 2. The immutability guards lock the version row (FOR SHARE) while they check its status: publishing
--    (an UPDATE of the status) waits for any transaction that is editing the draft, so a check that read
--    DRAFT cannot commit after the version was published.
-- 3. workflow_versions.revision: bumped by every save of the canvas, for optimistic concurrency.

-- ===========================================================================
-- 1. Version-scoped foreign keys of amount_rules
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM amount_rules r JOIN steps s ON s.tenant_id = r.tenant_id AND s.id = r.step_id
    WHERE s.version_id <> r.version_id
  ) OR EXISTS (
    SELECT 1 FROM amount_rules r JOIN steps s ON s.tenant_id = r.tenant_id AND s.id = r.approval_step_id
    WHERE s.version_id <> r.version_id
  ) THEN
    RAISE EXCEPTION 'cannot scope amount rules to their version: some point at steps of another version, fix them first';
  END IF;
END
$$;

ALTER TABLE amount_rules DROP CONSTRAINT amount_rules_tenant_id_step_id_fkey;
ALTER TABLE amount_rules DROP CONSTRAINT amount_rules_tenant_id_approval_step_id_fkey;
-- MATCH SIMPLE: a rule without step (or without approval step) is not checked, as before.
ALTER TABLE amount_rules ADD CONSTRAINT amount_rules_tenant_id_version_id_step_id_fkey
  FOREIGN KEY (tenant_id, version_id, step_id) REFERENCES steps (tenant_id, version_id, id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE amount_rules ADD CONSTRAINT amount_rules_tenant_id_version_id_approval_step_id_fkey
  FOREIGN KEY (tenant_id, version_id, approval_step_id) REFERENCES steps (tenant_id, version_id, id) ON DELETE NO ACTION ON UPDATE CASCADE;

-- The foreign keys need their own indexes (tenant purge and joins), which replace the old per-step ones.
CREATE INDEX amount_rules_tenant_id_version_id_step_id_idx ON amount_rules (tenant_id, version_id, step_id);
CREATE INDEX amount_rules_tenant_id_version_id_approval_step_id_idx ON amount_rules (tenant_id, version_id, approval_step_id);
DROP INDEX amount_rules_tenant_id_step_id_idx;
DROP INDEX amount_rules_tenant_id_approval_step_id_idx;

-- ===========================================================================
-- 2. FOR SHARE in the immutability guards (volatile now: row locks are not allowed in STABLE functions)
-- ===========================================================================
CREATE OR REPLACE FUNCTION assert_version_is_draft(p_tenant_id uuid, p_version_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE
  AS $$
  DECLARE
    v_status workflow_version_status;
  BEGIN
    IF app_is_purging(p_tenant_id) THEN
      RETURN;
    END IF;
    SELECT status INTO v_status FROM workflow_versions WHERE tenant_id = p_tenant_id AND id = p_version_id FOR SHARE;
    IF FOUND AND v_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'workflow version % is % and cannot be modified', p_version_id, v_status
        USING ERRCODE = '23001';
    END IF;
  END
  $$;

CREATE OR REPLACE FUNCTION assert_step_is_draft(p_tenant_id uuid, p_step_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE
  AS $$
  DECLARE
    v_version_id uuid;
  BEGIN
    SELECT version_id INTO v_version_id FROM steps WHERE tenant_id = p_tenant_id AND id = p_step_id;
    IF FOUND THEN
      PERFORM assert_version_is_draft(p_tenant_id, v_version_id);
    END IF;
  END
  $$;

-- ===========================================================================
-- 3. Optimistic concurrency of the canvas
-- ===========================================================================
ALTER TABLE workflow_versions ADD COLUMN revision integer NOT NULL DEFAULT 0;
