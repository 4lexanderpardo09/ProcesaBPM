-- Scheduled exports ("planos") come alive: what the tables of the first migration lacked to run them.
--
-- * export_definitions.weekdays replaces weekday: a weekly export can run on several days (1 = Monday … 7 = Sunday).
-- * export_definitions.separate_by: one file per responsible of a step, or per value of a column (NULL = one file).
-- * export_definitions.group_by keeps its name and means "merge the rows with the same value in this column".
-- * export_definitions.last_auto_cutoff_at: when the scheduled cutoff last ran, with or without lines, so a period
--   closes even when it had nothing and what arrives later waits for the next one.
-- * export_cutoffs: each file of a cutoff says which group it is (and whose, when separated by responsible).
-- * export_column_source: FORMULA, a value computed from the ticket's fields with the formula language.
ALTER TYPE export_column_source ADD VALUE 'FORMULA';

ALTER TABLE export_definitions DROP CONSTRAINT export_definitions_schedule;
ALTER TABLE export_definitions DROP COLUMN weekday;
ALTER TABLE export_definitions ADD COLUMN weekdays smallint[];
ALTER TABLE export_definitions ADD COLUMN separate_by jsonb;
ALTER TABLE export_definitions ADD COLUMN last_auto_cutoff_at timestamptz(3);
ALTER TABLE export_definitions ADD CONSTRAINT export_definitions_schedule CHECK (
  (frequency = 'DAILY') OR
  (frequency = 'WEEKLY' AND cardinality(weekdays) >= 1 AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]) OR
  (frequency = 'MONTHLY' AND month_day BETWEEN 1 AND 31) OR
  (frequency = 'EVERY_N_DAYS' AND interval_days >= 1)
);
ALTER TABLE export_definitions ADD CONSTRAINT export_definitions_separate_by CHECK (separate_by IS NULL OR jsonb_typeof(separate_by) = 'object');
ALTER TABLE export_definitions ADD CONSTRAINT export_definitions_filter CHECK (filter IS NULL OR jsonb_typeof(filter) = 'array');

ALTER TABLE export_cutoffs ADD COLUMN group_key text NOT NULL DEFAULT '';
ALTER TABLE export_cutoffs ADD COLUMN group_label text;
ALTER TABLE export_cutoffs ADD COLUMN responsible_id uuid;
ALTER TABLE export_cutoffs
  ADD CONSTRAINT export_cutoffs_responsible_fkey FOREIGN KEY (tenant_id, responsible_id) REFERENCES memberships (tenant_id, user_id) ON DELETE NO ACTION;
CREATE INDEX export_cutoffs_responsible_idx ON export_cutoffs (tenant_id, responsible_id) WHERE responsible_id IS NOT NULL;

-- The worker visits only the tenants with an active export; a tenant pending deletion runs nothing.
CREATE FUNCTION find_tenants_with_active_exports(p_limit integer) RETURNS TABLE (out_tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT d.tenant_id FROM export_definitions d
    WHERE d.is_active AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = d.tenant_id AND t.status = 'PENDING_DELETION')
    LIMIT least(greatest(p_limit, 1), 10000)
  $$;

ALTER FUNCTION find_tenants_with_active_exports(integer) OWNER TO app_platform;
REVOKE ALL ON FUNCTION find_tenants_with_active_exports(integer) FROM PUBLIC, app_runtime;
GRANT EXECUTE ON FUNCTION find_tenants_with_active_exports(integer) TO app_worker;
