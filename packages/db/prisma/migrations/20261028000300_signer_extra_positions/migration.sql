-- A POSITION signer can accept several positions (the help desk's signature for "Coordinador de crédito y cartera,
-- Gestor de cartera"): its own `position_id` plus the rows here. Whoever holds any of them signs for it.
CREATE TABLE "step_signer_positions" (
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "signer_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,

    CONSTRAINT "step_signer_positions_pkey" PRIMARY KEY ("tenant_id","signer_id","position_id")
);

CREATE INDEX "step_signer_positions_tenant_id_step_id_idx" ON "step_signer_positions"("tenant_id", "step_id");
CREATE INDEX "step_signer_positions_tenant_id_position_id_idx" ON "step_signer_positions"("tenant_id", "position_id");

ALTER TABLE "step_signer_positions" ADD CONSTRAINT "step_signer_positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "step_signer_positions" ADD CONSTRAINT "step_signer_positions_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "step_signer_positions" ADD CONSTRAINT "step_signer_positions_tenant_id_signer_id_fkey" FOREIGN KEY ("tenant_id", "signer_id") REFERENCES "step_signers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "step_signer_positions" ADD CONSTRAINT "step_signer_positions_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

SELECT app_enable_tenant_rls('step_signer_positions');

-- Like the other children of a step, only a draft's change: a published version is immutable.
CREATE TRIGGER guard_step_config BEFORE INSERT OR UPDATE OR DELETE ON step_signer_positions
  FOR EACH ROW EXECUTE FUNCTION trg_guard_step_config();

-- The extra positions belong to a POSITION signer of the same step.
CREATE FUNCTION trg_signer_position_matches_signer() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM step_signers s
      WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.signer_id AND s.step_id = NEW.step_id AND s.signer_type = 'POSITION'
    ) THEN
      RAISE EXCEPTION 'extra positions go with a POSITION signer of the same step' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER signer_position_matches_signer BEFORE INSERT OR UPDATE ON step_signer_positions
  FOR EACH ROW EXECUTE FUNCTION trg_signer_position_matches_signer();
