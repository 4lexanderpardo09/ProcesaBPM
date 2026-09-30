-- ProcesaBPM: tenant isolation (RLS), database roles, integrity rules that Prisma
-- cannot express, and SECURITY DEFINER entry points for flows that run before a
-- tenant is known (login, token refresh) or across tenants (outbox worker).
--
-- Runtime contract:
--   * The API connects with a login role that is a member of `app_runtime`.
--   * Every transaction starts with:
--       SELECT set_config('app.tenant_id', '<uuid>', true);
--       SELECT set_config('app.user_id',   '<uuid>', true);
--     (transaction-local, safe behind PgBouncer in transaction mode).
--   * Platform operations (tenant provisioning, billing, purge) use `app_platform`.
--   * Login roles are created by the infrastructure, e.g.:
--       CREATE ROLE procesabpm_api LOGIN PASSWORD '...' IN ROLE app_runtime;
--       ALTER ROLE procesabpm_api SET role = 'app_runtime';
--     The `SET role` is required: role attributes (BYPASSRLS) are not inherited
--     through membership, so the session must run as the app role itself.

-- ---------------------------------------------------------------------------
-- Roles (cluster-wide; created only if missing)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Request context helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- Row-Level Security on every tenant-owned table
-- Future migrations that add a tenant table must call app_enable_tenant_rls().
-- The test suite fails if any table with tenant_id lacks forced RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(p_table regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
  BEGIN
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      p_table
    );
  END
  $$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    PERFORM app_enable_tenant_rls(format('public.%I', t.table_name)::regclass);
  END LOOP;
END
$$;

-- The tenant row itself: a request only sees its own tenant and cannot create or delete tenants.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_read ON tenants FOR SELECT USING (id = app_current_tenant());
CREATE POLICY tenant_self_update ON tenants FOR UPDATE
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());

-- Global identities: visible when they are the current user or a member of the current tenant.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY user_visible ON users FOR SELECT USING (
  id = app_current_user()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)
);
CREATE POLICY user_self_update ON users FOR UPDATE
  USING (id = app_current_user()) WITH CHECK (id = app_current_user());
-- No INSERT policy: identities are created only through invite_user() (see the
-- integrity migration), never with a password chosen by another tenant.

-- Auth tables: a user only reaches their own rows. Lookups by token go through
-- the SECURITY DEFINER functions below.
ALTER TABLE refresh_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY own_sessions ON refresh_sessions
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());

ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY own_tokens ON user_tokens
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime, app_platform;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
REVOKE INSERT, UPDATE, DELETE ON plans, countries, country_holidays, permissions,
  platform_announcements FROM app_runtime;
REVOKE ALL ON platform_admins FROM app_runtime;
REVOKE INSERT, DELETE ON tenants FROM app_runtime;

GRANT ALL ON ALL TABLES IN SCHEMA public TO app_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_platform;
GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO app_runtime, app_platform;

-- ---------------------------------------------------------------------------
-- Integrity rules
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

-- Exactly one reference, matching the participant type.
ALTER TABLE step_candidates ADD CONSTRAINT step_candidates_one_reference CHECK (
  (participant_type = 'USER'     AND user_id IS NOT NULL     AND position_id IS NULL AND group_id IS NULL) OR
  (participant_type = 'POSITION' AND position_id IS NOT NULL AND user_id IS NULL     AND group_id IS NULL) OR
  (participant_type = 'GROUP'    AND group_id IS NOT NULL    AND user_id IS NULL     AND position_id IS NULL)
);
ALTER TABLE workflow_observers ADD CONSTRAINT workflow_observers_one_reference CHECK (
  (participant_type = 'USER'     AND user_id IS NOT NULL     AND position_id IS NULL AND group_id IS NULL) OR
  (participant_type = 'POSITION' AND position_id IS NOT NULL AND user_id IS NULL     AND group_id IS NULL) OR
  (participant_type = 'GROUP'    AND group_id IS NOT NULL    AND user_id IS NULL     AND position_id IS NULL)
);
ALTER TABLE step_initiators ADD CONSTRAINT step_initiators_one_reference CHECK (
  num_nonnulls(user_id, position_id, group_id, department_id, company_id, site_id) = 1 AND (
    (participant_type = 'USER'       AND user_id IS NOT NULL) OR
    (participant_type = 'POSITION'   AND position_id IS NOT NULL) OR
    (participant_type = 'GROUP'      AND group_id IS NOT NULL) OR
    (participant_type = 'DEPARTMENT' AND department_id IS NOT NULL) OR
    (participant_type = 'COMPANY'    AND company_id IS NOT NULL) OR
    (participant_type = 'SITE'       AND site_id IS NOT NULL)
  )
);
ALTER TABLE step_signers ADD CONSTRAINT step_signers_reference CHECK (
  (signer_type = 'USER'     AND user_id IS NOT NULL AND position_id IS NULL) OR
  (signer_type = 'POSITION' AND position_id IS NOT NULL AND user_id IS NULL) OR
  (signer_type IN ('APPROVER', 'CREATOR', 'STEP_ASSIGNEE') AND user_id IS NULL AND position_id IS NULL)
);

ALTER TABLE steps ADD CONSTRAINT steps_sla_pair CHECK ((sla_value IS NULL) = (sla_unit IS NULL));
ALTER TABLE steps ADD CONSTRAINT steps_sla_positive CHECK (sla_value IS NULL OR sla_value > 0);
ALTER TABLE steps ADD CONSTRAINT steps_cutoff_config CHECK (
  deadline_type <> 'CUTOFF' OR (deadline_field_code IS NOT NULL AND deadline_business_days > 0)
);
ALTER TABLE steps ADD CONSTRAINT steps_approval_config CHECK (
  assignment_mode <> 'APPROVER' OR (approval_group_type_id IS NOT NULL AND approval_level >= 1)
);
ALTER TABLE steps ADD CONSTRAINT steps_position_config CHECK (
  assignment_mode <> 'POSITION' OR position_id IS NOT NULL
);
ALTER TABLE steps ADD CONSTRAINT steps_max_loops_positive CHECK (max_loops IS NULL OR max_loops > 0);
ALTER TABLE step_sla_overrides ADD CONSTRAINT step_sla_overrides_positive CHECK (sla_value > 0);

ALTER TABLE transitions ADD CONSTRAINT transitions_condition_required CHECK (
  (type = 'CONDITION') = (condition IS NOT NULL)
);

ALTER TABLE amount_rules ADD CONSTRAINT amount_rules_positive CHECK (max_amount > 0);
ALTER TABLE amount_rules ADD CONSTRAINT amount_rules_extra_approval_step CHECK (
  (action = 'EXTRA_APPROVAL') = (approval_step_id IS NOT NULL)
);

ALTER TABLE calendar_working_hours ADD CONSTRAINT working_hours_weekday CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE calendar_working_hours ADD CONSTRAINT working_hours_range CHECK (start_time < end_time);
ALTER TABLE company_cutoffs ADD CONSTRAINT company_cutoffs_day CHECK (cutoff_day BETWEEN 1 AND 31);
ALTER TABLE company_cutoffs ADD CONSTRAINT company_cutoffs_grace CHECK (grace_business_days >= 0);
ALTER TABLE delegations ADD CONSTRAINT delegations_range CHECK (starts_at < ends_at);
ALTER TABLE delegations ADD CONSTRAINT delegations_not_self CHECK (from_user_id <> to_user_id);
ALTER TABLE approval_group_approvers ADD CONSTRAINT approvers_position CHECK (position >= 1);
ALTER TABLE sites ADD CONSTRAINT sites_level CHECK (level >= 1);

ALTER TABLE tickets ADD CONSTRAINT tickets_closed_consistency CHECK (
  (status = 'CLOSED') = (closed_at IS NOT NULL)
);
ALTER TABLE tickets ADD CONSTRAINT tickets_loop_positive CHECK (current_loop >= 1);
ALTER TABLE ticket_sla_clocks ADD CONSTRAINT sla_clocks_paused_minutes CHECK (paused_minutes >= 0);
ALTER TABLE ticket_sla_clocks ADD CONSTRAINT sla_clocks_result_when_completed CHECK (
  (completed_at IS NULL AND result IS NULL) OR
  (completed_at IS NOT NULL AND (sla_value IS NULL OR result IS NOT NULL))
);
ALTER TABLE ticket_sla_clocks ADD CONSTRAINT sla_clocks_sla_pair CHECK ((sla_value IS NULL) = (sla_unit IS NULL));
ALTER TABLE ticket_step_visits ADD CONSTRAINT step_visits_result_when_exited CHECK (
  (exited_at IS NULL AND result IS NULL) OR
  (exited_at IS NOT NULL AND (sla_value IS NULL OR result IS NOT NULL))
);
ALTER TABLE ticket_step_visits ADD CONSTRAINT step_visits_sla_pair CHECK ((sla_value IS NULL) = (sla_unit IS NULL));
ALTER TABLE ticket_step_visits ADD CONSTRAINT step_visits_paused_minutes CHECK (paused_minutes >= 0);
ALTER TABLE ticket_step_visits ADD CONSTRAINT step_visits_loop_positive CHECK (loop >= 1);
ALTER TABLE ticket_incidents ADD CONSTRAINT incidents_resolved_consistency CHECK (
  (status = 'RESOLVED') = (resolved_at IS NOT NULL)
);

-- Files: 4 MB per user upload (docs/analisis.md §7.2). System-generated PDFs are not capped here.
ALTER TABLE stored_files ADD CONSTRAINT stored_files_user_size CHECK (
  origin <> 'USER' OR size_bytes <= 4194304
);
ALTER TABLE stored_files ADD CONSTRAINT stored_files_size_positive CHECK (size_bytes > 0);
ALTER TABLE ticket_documents ADD CONSTRAINT ticket_documents_version CHECK (version >= 1);

ALTER TABLE workflow_documents ADD CONSTRAINT workflow_documents_source CHECK (
  (kind = 'DESIGNED' AND format_id IS NOT NULL AND template_id IS NULL) OR
  (kind = 'TEMPLATE' AND template_id IS NOT NULL AND format_id IS NULL)
);
ALTER TABLE pdf_template_fields ADD CONSTRAINT pdf_template_fields_mode CHECK (
  (mode = 'COORDINATES' AND page IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL) OR
  (mode = 'ACROFORM' AND acroform_name IS NOT NULL)
);
ALTER TABLE pdf_template_fields ADD CONSTRAINT pdf_template_fields_source CHECK (
  num_nonnulls(field_code, expression) = 1
);
ALTER TABLE pdf_template_signatures ADD CONSTRAINT pdf_template_signatures_mode CHECK (
  (mode = 'COORDINATES' AND page IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL) OR
  (mode = 'ACROFORM' AND acroform_name IS NOT NULL)
);

ALTER TABLE export_definitions ADD CONSTRAINT export_definitions_schedule CHECK (
  (frequency = 'DAILY') OR
  (frequency = 'WEEKLY' AND weekday BETWEEN 0 AND 6) OR
  (frequency = 'MONTHLY' AND month_day BETWEEN 1 AND 31) OR
  (frequency = 'EVERY_N_DAYS' AND interval_days >= 1)
);
ALTER TABLE export_definitions ADD CONSTRAINT export_definitions_transition_label CHECK (
  trigger <> 'TRANSITION' OR transition_label IS NOT NULL
);

ALTER TABLE plans ADD CONSTRAINT plans_storage_non_negative CHECK (
  storage_base_bytes >= 0 AND storage_per_user_bytes >= 0 AND storage_grace_percent BETWEEN 0 AND 100
);
ALTER TABLE tenant_usage ADD CONSTRAINT tenant_usage_non_negative CHECK (bytes_used >= 0 AND bytes_reserved >= 0);

-- ---------------------------------------------------------------------------
-- Partial unique indexes ("only one of")
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX companies_one_default ON companies (tenant_id) WHERE is_default;
CREATE UNIQUE INDEX calendars_one_default ON calendars (tenant_id) WHERE is_default;
CREATE UNIQUE INDEX approval_group_types_one_default ON approval_group_types (tenant_id) WHERE is_default;
CREATE UNIQUE INDEX workflow_versions_one_draft ON workflow_versions (tenant_id, workflow_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX workflow_versions_one_published ON workflow_versions (tenant_id, workflow_id) WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX ticket_incidents_one_open ON ticket_incidents (tenant_id, ticket_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX ticket_documents_one_current ON ticket_documents (tenant_id, ticket_id, role, step_id)
  NULLS NOT DISTINCT WHERE is_current AND role IN ('MAIN_DOCUMENT', 'STEP_DOCUMENT') AND deleted_at IS NULL;
CREATE UNIQUE INDEX sla_clocks_one_running ON ticket_sla_clocks (tenant_id, ticket_id, step_id, loop, responsible_id)
  NULLS NOT DISTINCT WHERE completed_at IS NULL;
CREATE UNIQUE INDEX memberships_one_owner ON memberships (tenant_id) WHERE is_owner;

-- Hot paths for the worker
CREATE INDEX sla_clocks_due ON ticket_sla_clocks (due_at)
  WHERE completed_at IS NULL AND alerted_at IS NULL AND paused_at IS NULL;
CREATE INDEX stored_files_pending ON stored_files (created_at) WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Per-tenant counters (ticket numbers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_tenant_sequence(p_name text) RETURNS bigint
  LANGUAGE sql VOLATILE
  AS $$
    INSERT INTO tenant_sequences (tenant_id, name, last_value)
    VALUES (app_current_tenant(), p_name, 1)
    ON CONFLICT (tenant_id, name) DO UPDATE SET last_value = tenant_sequences.last_value + 1
    RETURNING last_value
  $$;
GRANT EXECUTE ON FUNCTION next_tenant_sequence(text) TO app_runtime;

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER entry points (run with the owner's rights; keep them minimal)
-- ---------------------------------------------------------------------------

-- Login: find a user by e-mail before any tenant is selected.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
  RETURNS TABLE (id uuid, password_hash text, status user_status, locked_until timestamptz, mfa_enabled boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.password_hash, u.status, u.locked_until, u.mfa_enabled
    FROM users u WHERE u.email = lower(p_email)
  $$;

-- Organization picker after login.
CREATE OR REPLACE FUNCTION auth_list_memberships(p_user_id uuid)
  RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text, membership_status membership_status)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.slug, t.name, m.status
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id AND t.status IN ('ACTIVE', 'SUSPENDED') AND m.status <> 'INACTIVE'
  $$;

-- Token refresh: resolve the session by its hash.
CREATE OR REPLACE FUNCTION auth_find_refresh_session(p_token_hash text)
  RETURNS TABLE (id uuid, user_id uuid, active_tenant_id uuid, expires_at timestamptz, revoked_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT s.id, s.user_id, s.active_tenant_id, s.expires_at, s.revoked_at
    FROM refresh_sessions s WHERE s.token_hash = p_token_hash
  $$;

-- Password reset / e-mail verification / invitation links.
CREATE OR REPLACE FUNCTION auth_find_user_token(p_token_hash text)
  RETURNS TABLE (id uuid, user_id uuid, type user_token_type, invited_tenant_id uuid, expires_at timestamptz, consumed_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.user_id, t.type, t.invited_tenant_id, t.expires_at, t.consumed_at
    FROM user_tokens t WHERE t.token_hash = p_token_hash
  $$;

-- Outbox worker: claim a batch across tenants; each event is then processed
-- inside a transaction with its own app.tenant_id.
CREATE OR REPLACE FUNCTION claim_outbox_events(p_limit integer)
  RETURNS SETOF outbox_events
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE outbox_events o
    SET status = 'PROCESSING', attempts = o.attempts + 1
    WHERE (o.tenant_id, o.id) IN (
      SELECT tenant_id, id FROM outbox_events
      WHERE status = 'PENDING' AND available_at <= now()
      ORDER BY available_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o.*
  $$;

-- Owned by app_platform (BYPASSRLS): FORCE RLS would otherwise filter the owner too.
ALTER FUNCTION auth_find_user_by_email(text) OWNER TO app_platform;
ALTER FUNCTION auth_list_memberships(uuid) OWNER TO app_platform;
ALTER FUNCTION auth_find_refresh_session(text) OWNER TO app_platform;
ALTER FUNCTION auth_find_user_token(text) OWNER TO app_platform;
ALTER FUNCTION claim_outbox_events(integer) OWNER TO app_platform;

REVOKE ALL ON FUNCTION auth_find_user_by_email(text), auth_list_memberships(uuid),
  auth_find_refresh_session(text), auth_find_user_token(text), claim_outbox_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text), auth_list_memberships(uuid),
  auth_find_refresh_session(text), auth_find_user_token(text), claim_outbox_events(integer) TO app_runtime;
