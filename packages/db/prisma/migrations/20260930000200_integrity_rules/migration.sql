-- ProcesaBPM: business integrity rules enforced by the database.
-- Every rule below closes a gap found in docs/revision-bd.md and has a test in
-- packages/db/test. Error codes used by the triggers:
--   23001 restrict_violation  -> immutable data (published versions, fixed ticket columns)
--   23514 check_violation     -> invalid business state
--   42501 insufficient_privilege -> caller not allowed

-- Extensions live in their own schema so `public` only holds ProcesaBPM objects.
-- The search_path below is only needed while this migration creates the
-- exclusion constraints (they store the operator classes they use).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;
SET search_path = public, extensions;

-- ===========================================================================
-- 1. Identities: column privileges and controlled entry points
-- ===========================================================================

-- The API never reads credentials and never creates identities directly.
REVOKE SELECT, INSERT, UPDATE ON users FROM app_runtime;
GRANT SELECT (id, email, first_name, last_name, document_number, status, locale, time_zone,
              mfa_enabled, email_verified_at, last_login_at, created_at, updated_at)
  ON users TO app_runtime;
GRANT UPDATE (first_name, last_name, document_number, locale, time_zone, updated_at)
  ON users TO app_runtime;

-- Tokens are only issued and consumed through the functions below.
REVOKE ALL ON user_tokens FROM app_runtime;

-- Global catalog: read-only for the API.
REVOKE INSERT, UPDATE, DELETE ON currencies FROM app_runtime;

-- The organization picker only lists the memberships of the authenticated user.
CREATE OR REPLACE FUNCTION auth_list_memberships(p_user_id uuid)
  RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text, membership_status membership_status)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.slug, t.name, m.status
    FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id
      AND p_user_id = app_current_user()
      AND t.status IN ('ACTIVE', 'SUSPENDED')
      AND m.status <> 'INACTIVE'
  $$;

-- Creates the global identity WITHOUT a password (or returns the existing one).
-- The password is only set by the invitee through the e-mailed token.
CREATE FUNCTION invite_user(p_email text, p_first_name text, p_last_name text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    v_user_id uuid;
  BEGIN
    IF app_current_tenant() IS NULL THEN
      RAISE EXCEPTION 'invite_user requires a tenant context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO users (email, first_name, last_name)
    VALUES (lower(trim(p_email)), p_first_name, p_last_name)
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_user_id;
    IF v_user_id IS NULL THEN
      SELECT id INTO v_user_id FROM users WHERE email = lower(trim(p_email));
    END IF;
    RETURN v_user_id;
  END
  $$;

-- Issues a one-time token. Only its hash is stored; the clear token goes by e-mail.
CREATE FUNCTION auth_issue_user_token(
  p_user_id uuid,
  p_type user_token_type,
  p_token_hash text,
  p_expires_at timestamptz,
  p_payload jsonb DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    v_token_id uuid;
    v_invited_tenant uuid;
  BEGIN
    IF p_expires_at <= now() THEN
      RAISE EXCEPTION 'token expiration must be in the future' USING ERRCODE = '23514';
    END IF;

    IF p_type = 'EMAIL_CHANGE' THEN
      IF p_user_id IS DISTINCT FROM app_current_user() THEN
        RAISE EXCEPTION 'only the user can request an e-mail change' USING ERRCODE = '42501';
      END IF;
      IF p_payload ->> 'email' IS NULL THEN
        RAISE EXCEPTION 'EMAIL_CHANGE requires payload.email' USING ERRCODE = '23514';
      END IF;
    ELSIF p_type = 'INVITATION' THEN
      v_invited_tenant := app_current_tenant();
      IF NOT EXISTS (SELECT 1 FROM memberships WHERE tenant_id = v_invited_tenant AND user_id = p_user_id) THEN
        RAISE EXCEPTION 'the invited user has no membership in the current tenant' USING ERRCODE = '42501';
      END IF;
    END IF;

    INSERT INTO user_tokens (user_id, type, token_hash, invited_tenant_id, payload, expires_at)
    VALUES (p_user_id, p_type, p_token_hash, v_invited_tenant, p_payload, p_expires_at)
    RETURNING id INTO v_token_id;
    RETURN v_token_id;
  END
  $$;

-- Consumes a token once and applies its effect atomically.
CREATE FUNCTION auth_consume_user_token(p_token_hash text, p_new_password_hash text DEFAULT NULL)
  RETURNS TABLE (user_id uuid, token_type user_token_type, invited_tenant_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
  #variable_conflict use_column
  DECLARE
    v_token user_tokens%ROWTYPE;
  BEGIN
    SELECT * INTO v_token FROM user_tokens WHERE token_hash = p_token_hash FOR UPDATE;
    IF NOT FOUND OR v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now() THEN
      RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '42501';
    END IF;

    IF v_token.type IN ('PASSWORD_RESET', 'INVITATION') AND p_new_password_hash IS NULL
       AND (v_token.type = 'PASSWORD_RESET'
            OR (SELECT u.password_hash IS NULL FROM users u WHERE u.id = v_token.user_id)) THEN
      RAISE EXCEPTION 'a new password is required' USING ERRCODE = '23514';
    END IF;

    CASE v_token.type
      WHEN 'PASSWORD_RESET' THEN
        UPDATE users SET password_hash = p_new_password_hash, failed_logins = 0, locked_until = NULL
        WHERE id = v_token.user_id;
        UPDATE refresh_sessions SET revoked_at = now()
        WHERE refresh_sessions.user_id = v_token.user_id AND revoked_at IS NULL;
      WHEN 'INVITATION' THEN
        UPDATE users SET password_hash = coalesce(p_new_password_hash, password_hash),
                         email_verified_at = coalesce(email_verified_at, now())
        WHERE id = v_token.user_id;
        UPDATE memberships SET status = 'ACTIVE', joined_at = now()
        WHERE tenant_id = v_token.invited_tenant_id AND memberships.user_id = v_token.user_id
          AND status = 'INVITED';
      WHEN 'EMAIL_VERIFICATION' THEN
        UPDATE users SET email_verified_at = now() WHERE id = v_token.user_id;
      WHEN 'EMAIL_CHANGE' THEN
        UPDATE users SET email = lower(trim(v_token.payload ->> 'email')), email_verified_at = now()
        WHERE id = v_token.user_id;
    END CASE;

    UPDATE user_tokens SET consumed_at = now() WHERE id = v_token.id;
    RETURN QUERY SELECT v_token.user_id, v_token.type, v_token.invited_tenant_id;
  END
  $$;

-- Records a login attempt and applies the lockout policy.
CREATE FUNCTION auth_register_login_attempt(
  p_user_id uuid,
  p_success boolean,
  p_max_failed integer,
  p_lock_minutes integer
) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE users SET
      failed_logins = CASE WHEN p_success THEN 0 ELSE failed_logins + 1 END,
      last_login_at = CASE WHEN p_success THEN now() ELSE last_login_at END,
      locked_until  = CASE
                        WHEN p_success THEN NULL
                        WHEN failed_logins + 1 >= p_max_failed THEN now() + make_interval(mins => p_lock_minutes)
                        ELSE locked_until
                      END
    WHERE id = p_user_id
  $$;

-- Password change while logged in (the API verifies the current password first).
CREATE FUNCTION auth_set_own_password(p_new_password_hash text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN
      RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501';
    END IF;
    UPDATE users SET password_hash = p_new_password_hash WHERE id = app_current_user();
  END
  $$;

-- MFA: the encrypted secret is only reachable by its own user.
CREATE FUNCTION auth_get_own_mfa_secret() RETURNS bytea
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT mfa_secret_encrypted FROM users WHERE id = app_current_user() $$;

CREATE FUNCTION auth_set_own_mfa(p_secret_encrypted bytea, p_enabled boolean) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    IF app_current_user() IS NULL THEN
      RAISE EXCEPTION 'no authenticated user' USING ERRCODE = '42501';
    END IF;
    UPDATE users SET mfa_secret_encrypted = p_secret_encrypted, mfa_enabled = p_enabled
    WHERE id = app_current_user();
  END
  $$;

ALTER FUNCTION auth_list_memberships(uuid) OWNER TO app_platform;
ALTER FUNCTION invite_user(text, text, text) OWNER TO app_platform;
ALTER FUNCTION auth_issue_user_token(uuid, user_token_type, text, timestamptz, jsonb) OWNER TO app_platform;
ALTER FUNCTION auth_consume_user_token(text, text) OWNER TO app_platform;
ALTER FUNCTION auth_register_login_attempt(uuid, boolean, integer, integer) OWNER TO app_platform;
ALTER FUNCTION auth_set_own_password(text) OWNER TO app_platform;
ALTER FUNCTION auth_get_own_mfa_secret() OWNER TO app_platform;
ALTER FUNCTION auth_set_own_mfa(bytea, boolean) OWNER TO app_platform;

REVOKE ALL ON FUNCTION invite_user(text, text, text),
  auth_issue_user_token(uuid, user_token_type, text, timestamptz, jsonb),
  auth_consume_user_token(text, text),
  auth_register_login_attempt(uuid, boolean, integer, integer),
  auth_set_own_password(text), auth_get_own_mfa_secret(), auth_set_own_mfa(bytea, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_user(text, text, text),
  auth_issue_user_token(uuid, user_token_type, text, timestamptz, jsonb),
  auth_consume_user_token(text, text),
  auth_register_login_attempt(uuid, boolean, integer, integer),
  auth_set_own_password(text), auth_get_own_mfa_secret(), auth_set_own_mfa(bytea, boolean)
  TO app_runtime;

-- ===========================================================================
-- 2. Append-only history
-- ===========================================================================
REVOKE UPDATE, DELETE ON audit_logs, ticket_events, ticket_errors, ticket_signatures FROM app_runtime;

-- ===========================================================================
-- 3. Published workflow versions are immutable
-- ===========================================================================

-- The tenant purge (purge_tenant) is the only operation allowed to remove
-- published configuration; it announces itself with app.purge_tenant.
CREATE FUNCTION app_is_purging(p_tenant_id uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.purge_tenant', true), '') = p_tenant_id::text $$;

CREATE FUNCTION assert_version_is_draft(p_tenant_id uuid, p_version_id uuid) RETURNS void
  LANGUAGE plpgsql STABLE
  AS $$
  DECLARE
    v_status workflow_version_status;
  BEGIN
    IF app_is_purging(p_tenant_id) THEN
      RETURN;
    END IF;
    SELECT status INTO v_status FROM workflow_versions WHERE tenant_id = p_tenant_id AND id = p_version_id;
    IF FOUND AND v_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'workflow version % is % and cannot be modified', p_version_id, v_status
        USING ERRCODE = '23001';
    END IF;
  END
  $$;

-- Tables that carry version_id directly.
CREATE FUNCTION trg_guard_version_config() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM assert_version_is_draft(OLD.tenant_id, OLD.version_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      PERFORM assert_version_is_draft(NEW.tenant_id, NEW.version_id);
      RETURN NEW;
    END IF;
    RETURN OLD;
  END
  $$;

-- Tables that hang from a step.
CREATE FUNCTION assert_step_is_draft(p_tenant_id uuid, p_step_id uuid) RETURNS void
  LANGUAGE plpgsql STABLE
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

CREATE FUNCTION trg_guard_step_config() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM assert_step_is_draft(OLD.tenant_id, OLD.step_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      PERFORM assert_step_is_draft(NEW.tenant_id, NEW.step_id);
      RETURN NEW;
    END IF;
    RETURN OLD;
  END
  $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['steps', 'transitions', 'fields', 'amount_rules'] LOOP
    EXECUTE format(
      'CREATE TRIGGER guard_version_config BEFORE INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION trg_guard_version_config()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['step_candidates', 'step_initiators', 'step_sla_overrides', 'step_signers', 'step_files'] LOOP
    EXECUTE format(
      'CREATE TRIGGER guard_step_config BEFORE INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION trg_guard_step_config()', t);
  END LOOP;
END
$$;

-- Version lifecycle: DRAFT -> PUBLISHED -> ARCHIVED, never backwards; only drafts are deleted.
CREATE FUNCTION trg_guard_version_lifecycle() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status <> 'DRAFT' AND NOT app_is_purging(OLD.tenant_id) THEN
        RAISE EXCEPTION 'only draft versions can be deleted' USING ERRCODE = '23001';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.workflow_id <> OLD.workflow_id OR NEW.number <> OLD.number THEN
      RAISE EXCEPTION 'workflow_id and number of a version are immutable' USING ERRCODE = '23001';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR
         (OLD.status = 'PUBLISHED' AND NEW.status = 'ARCHIVED')) THEN
      RAISE EXCEPTION 'invalid version status change % -> %', OLD.status, NEW.status USING ERRCODE = '23001';
    END IF;
    IF NEW.status = 'PUBLISHED' AND OLD.status = 'DRAFT' THEN
      NEW.published_at := coalesce(NEW.published_at, now());
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER guard_version_lifecycle BEFORE UPDATE OR DELETE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION trg_guard_version_lifecycle();

-- A workflow never moves to another subcategory (tickets derive it).
CREATE FUNCTION trg_workflow_subcategory_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.subcategory_id <> OLD.subcategory_id THEN
      RAISE EXCEPTION 'workflows.subcategory_id is immutable' USING ERRCODE = '23001';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER workflow_subcategory_immutable BEFORE UPDATE OF subcategory_id ON workflows
  FOR EACH ROW EXECUTE FUNCTION trg_workflow_subcategory_immutable();

-- ===========================================================================
-- 4. Step and transition rules
-- ===========================================================================

-- Automatic blocks have no responsible, no SLA and never close a ticket by hand.
CREATE FUNCTION is_automatic_step(p_type step_type) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT p_type IN ('START', 'CONDITION', 'DOCUMENT', 'EXPORT', 'NOTIFICATION', 'WEBHOOK', 'CALCULATOR', 'WAIT', 'END') $$;

ALTER TABLE steps ADD CONSTRAINT steps_assignment_by_type CHECK (
  is_automatic_step(type) = (assignment_mode = 'NONE')
);
ALTER TABLE steps ADD CONSTRAINT steps_automatic_without_sla CHECK (
  NOT is_automatic_step(type) OR (sla_value IS NULL AND close_rule = 'NOT_ALLOWED' AND NOT manual_selection)
);

CREATE FUNCTION trg_validate_transition() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_from step_type;
    v_to step_type;
  BEGIN
    SELECT type INTO v_from FROM steps WHERE tenant_id = NEW.tenant_id AND id = NEW.from_step_id;
    SELECT type INTO v_to FROM steps WHERE tenant_id = NEW.tenant_id AND id = NEW.to_step_id;

    IF v_from = 'END' THEN
      RAISE EXCEPTION 'an END step cannot have outgoing transitions' USING ERRCODE = '23514';
    END IF;
    IF v_to = 'START' THEN
      RAISE EXCEPTION 'a START step cannot have incoming transitions' USING ERRCODE = '23514';
    END IF;
    IF NEW.type = 'CONDITION' AND v_from <> 'CONDITION' THEN
      RAISE EXCEPTION 'CONDITION transitions must leave a CONDITION step' USING ERRCODE = '23514';
    END IF;
    IF NEW.type = 'DEFAULT' AND NOT is_automatic_step(v_from) THEN
      RAISE EXCEPTION 'DEFAULT transitions must leave an automatic step' USING ERRCODE = '23514';
    END IF;
    IF NEW.type = 'DECISION' AND is_automatic_step(v_from) THEN
      RAISE EXCEPTION 'DECISION transitions must leave a step handled by a person' USING ERRCODE = '23514';
    END IF;
    IF v_from = 'CONDITION' AND NEW.type NOT IN ('CONDITION', 'DEFAULT', 'SYSTEM_ONLY') THEN
      RAISE EXCEPTION 'a CONDITION step only has CONDITION or DEFAULT exits' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER validate_transition BEFORE INSERT OR UPDATE ON transitions
  FOR EACH ROW EXECUTE FUNCTION trg_validate_transition();

-- Changing a step type must not invalidate its existing transitions.
CREATE FUNCTION trg_step_type_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.type <> OLD.type AND EXISTS (
      SELECT 1 FROM transitions WHERE tenant_id = NEW.tenant_id AND (from_step_id = NEW.id OR to_step_id = NEW.id)
    ) THEN
      RAISE EXCEPTION 'remove the transitions of the step before changing its type' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER step_type_change BEFORE UPDATE OF type ON steps
  FOR EACH ROW EXECUTE FUNCTION trg_step_type_change();

CREATE UNIQUE INDEX transitions_one_default ON transitions (tenant_id, from_step_id) WHERE type = 'DEFAULT';
CREATE UNIQUE INDEX transitions_unique_label ON transitions (tenant_id, from_step_id, lower(label));

-- ===========================================================================
-- 5. Tickets
-- ===========================================================================

-- Identity columns of a ticket never change after creation.
CREATE FUNCTION trg_ticket_fixed_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.number, NEW.workflow_id, NEW.workflow_version_id, NEW.subcategory_id, NEW.company_id,
        NEW.creator_id, NEW.registered_by_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.number, OLD.workflow_id, OLD.workflow_version_id, OLD.subcategory_id, OLD.company_id,
        OLD.creator_id, OLD.registered_by_id, OLD.created_at) THEN
      RAISE EXCEPTION 'number, workflow, version, subcategory, company, creator and created_at are immutable'
        USING ERRCODE = '23001';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER ticket_fixed_columns BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION trg_ticket_fixed_columns();

-- Ticket state vs. incidents and parallel tasks, checked at COMMIT so the API can
-- update the ticket and its incident in any order inside one transaction:
--   PAUSED  <=> there is an OPEN incident
--   CLOSED   => no OPEN incident and no PENDING parallel task
CREATE FUNCTION assert_ticket_state(p_tenant_id uuid, p_ticket_id uuid) RETURNS void
  LANGUAGE plpgsql STABLE
  AS $$
  DECLARE
    v_status ticket_status;
    v_open_incident boolean;
  BEGIN
    SELECT status INTO v_status FROM tickets WHERE tenant_id = p_tenant_id AND id = p_ticket_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    v_open_incident := EXISTS (
      SELECT 1 FROM ticket_incidents WHERE tenant_id = p_tenant_id AND ticket_id = p_ticket_id AND status = 'OPEN'
    );
    IF (v_status = 'PAUSED') <> v_open_incident THEN
      RAISE EXCEPTION 'ticket % is % but % an open incident', p_ticket_id, v_status,
        CASE WHEN v_open_incident THEN 'has' ELSE 'has no' END
        USING ERRCODE = '23514';
    END IF;
    IF v_status = 'CLOSED' AND EXISTS (
      SELECT 1 FROM ticket_parallel_tasks WHERE tenant_id = p_tenant_id AND ticket_id = p_ticket_id AND status = 'PENDING'
    ) THEN
      RAISE EXCEPTION 'ticket % cannot be closed with pending parallel tasks', p_ticket_id USING ERRCODE = '23514';
    END IF;
  END
  $$;

CREATE FUNCTION trg_check_ticket_state() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_TABLE_NAME = 'tickets' THEN
      PERFORM assert_ticket_state(NEW.tenant_id, NEW.id);
    ELSIF TG_OP = 'DELETE' THEN
      PERFORM assert_ticket_state(OLD.tenant_id, OLD.ticket_id);
    ELSE
      PERFORM assert_ticket_state(NEW.tenant_id, NEW.ticket_id);
    END IF;
    RETURN NULL;
  END
  $$;

CREATE CONSTRAINT TRIGGER check_ticket_state AFTER INSERT OR UPDATE ON tickets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_check_ticket_state();
CREATE CONSTRAINT TRIGGER check_ticket_state AFTER INSERT OR UPDATE OR DELETE ON ticket_incidents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_check_ticket_state();
CREATE CONSTRAINT TRIGGER check_ticket_state AFTER INSERT OR UPDATE ON ticket_parallel_tasks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_check_ticket_state();

-- A signed/rejected parallel task stops holding the ticket.
CREATE FUNCTION trg_parallel_task_done() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    DELETE FROM ticket_assignees
    WHERE tenant_id = NEW.tenant_id AND ticket_id = NEW.ticket_id AND user_id = NEW.user_id AND type = 'PARALLEL';
    RETURN NULL;
  END
  $$;
CREATE TRIGGER parallel_task_done AFTER UPDATE OF status ON ticket_parallel_tasks
  FOR EACH ROW WHEN (OLD.status = 'PENDING' AND NEW.status <> 'PENDING')
  EXECUTE FUNCTION trg_parallel_task_done();

-- Visits and clocks belong to the same step/loop; clocks of a visit share its ticket.
ALTER TABLE ticket_sla_clocks ADD CONSTRAINT sla_clocks_loop_positive CHECK (loop >= 1);
CREATE FUNCTION trg_clock_matches_visit() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM ticket_step_visits v
      WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
        AND v.ticket_id = NEW.ticket_id AND v.step_id = NEW.step_id AND v."loop" = NEW."loop"
    ) THEN
      RAISE EXCEPTION 'SLA clock does not match its step visit' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER clock_matches_visit BEFORE INSERT OR UPDATE ON ticket_sla_clocks
  FOR EACH ROW EXECUTE FUNCTION trg_clock_matches_visit();
-- A ticket is in one step at a time: at most one open visit.
CREATE UNIQUE INDEX step_visits_one_open ON ticket_step_visits (tenant_id, ticket_id) WHERE exited_at IS NULL;

-- ===========================================================================
-- 6. People, approvals, calendars
-- ===========================================================================

-- Approval members inherit type and company from their group.
CREATE FUNCTION trg_approval_member_sync() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    SELECT g.type_id, g.company_id INTO NEW.type_id, NEW.company_id
    FROM approval_groups g WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.group_id;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER approval_member_sync BEFORE INSERT OR UPDATE ON approval_group_members
  FOR EACH ROW EXECUTE FUNCTION trg_approval_member_sync();

CREATE FUNCTION trg_approval_group_scope_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.type_id, NEW.company_id) IS DISTINCT FROM (OLD.type_id, OLD.company_id)
       AND EXISTS (SELECT 1 FROM approval_group_members WHERE tenant_id = NEW.tenant_id AND group_id = NEW.id) THEN
      RAISE EXCEPTION 'remove the members before changing the type or company of an approval group'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER approval_group_scope_fixed BEFORE UPDATE OF type_id, company_id ON approval_groups
  FOR EACH ROW EXECUTE FUNCTION trg_approval_group_scope_fixed();

-- One approval group per (type, company) per user; NULL company = every company.
-- Prisma creates this index with NULLS DISTINCT; it is recreated with NULLS NOT DISTINCT
-- so two "every company" groups of the same type are also rejected.
DROP INDEX approval_members_one_group;
CREATE UNIQUE INDEX approval_members_one_group ON approval_group_members (tenant_id, type_id, company_id, user_id)
  NULLS NOT DISTINCT;

-- Delegations of the same person cannot overlap, and cannot point back at each other.
ALTER TABLE delegations ADD CONSTRAINT delegations_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, from_user_id WITH =, tstzrange(starts_at, ends_at) WITH &&
);
CREATE FUNCTION trg_delegation_not_circular() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM delegations d
      WHERE d.tenant_id = NEW.tenant_id AND d.from_user_id = NEW.to_user_id AND d.to_user_id = NEW.from_user_id
        AND tstzrange(d.starts_at, d.ends_at) && tstzrange(NEW.starts_at, NEW.ends_at)
    ) THEN
      RAISE EXCEPTION 'circular delegation in the same period' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER delegation_not_circular BEFORE INSERT OR UPDATE ON delegations
  FOR EACH ROW EXECUTE FUNCTION trg_delegation_not_circular();

-- Working shifts of the same day cannot overlap (overnight shifts are split in two rows).
CREATE FUNCTION seconds_of_day(p_time time) RETURNS integer
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT (extract(hour FROM p_time) * 3600 + extract(minute FROM p_time) * 60 + extract(second FROM p_time))::integer $$;
ALTER TABLE calendar_working_hours ADD CONSTRAINT working_hours_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, calendar_id WITH =, weekday WITH =,
  int4range(seconds_of_day(start_time), seconds_of_day(end_time)) WITH &&
);

-- Active memberships always belong to at least one company (checked at COMMIT).
CREATE FUNCTION assert_membership_has_company(p_tenant_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql STABLE
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = p_user_id AND m.status = 'ACTIVE')
       AND NOT EXISTS (SELECT 1 FROM membership_companies mc WHERE mc.tenant_id = p_tenant_id AND mc.user_id = p_user_id) THEN
      RAISE EXCEPTION 'active membership % has no company', p_user_id USING ERRCODE = '23514';
    END IF;
  END
  $$;
CREATE FUNCTION trg_check_membership_company() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      PERFORM assert_membership_has_company(OLD.tenant_id, OLD.user_id);
    ELSE
      PERFORM assert_membership_has_company(NEW.tenant_id, NEW.user_id);
    END IF;
    RETURN NULL;
  END
  $$;
CREATE CONSTRAINT TRIGGER check_membership_company AFTER INSERT OR UPDATE OF status ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_check_membership_company();
CREATE CONSTRAINT TRIGGER check_membership_company AFTER DELETE ON membership_companies
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_check_membership_company();

-- ===========================================================================
-- 7. Value validation
-- ===========================================================================
CREATE FUNCTION is_valid_time_zone(p_name text) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT p_name IS NULL OR EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_name) $$;

ALTER TABLE tenants ADD CONSTRAINT tenants_time_zone_valid CHECK (is_valid_time_zone(time_zone));
ALTER TABLE companies ADD CONSTRAINT companies_time_zone_valid CHECK (is_valid_time_zone(time_zone));
ALTER TABLE countries ADD CONSTRAINT countries_time_zone_valid CHECK (is_valid_time_zone(time_zone));
ALTER TABLE users ADD CONSTRAINT users_time_zone_valid CHECK (is_valid_time_zone(time_zone));
ALTER TABLE users ADD CONSTRAINT users_locale_format CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$');
ALTER TABLE currencies ADD CONSTRAINT currencies_code_format CHECK (code ~ '^[A-Z]{3}$');
ALTER TABLE currencies ADD CONSTRAINT currencies_decimals CHECK (decimals BETWEEN 0 AND 4);
ALTER TABLE countries ADD CONSTRAINT countries_code_format CHECK (code ~ '^[A-Z]{2}$');
ALTER TABLE stored_files ADD CONSTRAINT stored_files_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE tenants ADD CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');
ALTER TABLE tenants ADD CONSTRAINT tenants_primary_color CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE fields ADD CONSTRAINT fields_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{0,99}$');

-- ===========================================================================
-- 8. updated_at maintained by the database for every writer (API, jobs, SQL)
-- ===========================================================================
CREATE FUNCTION trg_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END
  $$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()',
      t.table_name);
  END LOOP;
END
$$;

-- ===========================================================================
-- 9. Search and hot-path indexes
-- ===========================================================================
-- Prisma declares the column as a plain tsvector; it is replaced by a generated one
-- (the index goes with the column and is recreated below).
ALTER TABLE tickets DROP COLUMN search_vector;
ALTER TABLE tickets ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  to_tsvector('spanish'::regconfig,
    coalesce(title, '') || ' ' || regexp_replace(coalesce(description_html, ''), '<[^>]*>', ' ', 'g'))
) STORED;
CREATE INDEX tickets_search ON tickets USING gin (search_vector);

CREATE INDEX outbox_events_pending ON outbox_events (available_at) WHERE status = 'PENDING';

-- ===========================================================================
-- 10. Platform maintenance (app_platform only)
-- ===========================================================================

-- Deletes a tenant and every row it owns in one transaction, plus the global
-- identities that belonged only to it. Files in storage are removed by the purge job.
CREATE FUNCTION purge_tenant(p_tenant_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    v_user_ids uuid[];
  BEGIN
    SELECT array_agg(user_id) INTO v_user_ids FROM memberships WHERE tenant_id = p_tenant_id;
    PERFORM set_config('app.purge_tenant', p_tenant_id::text, true);
    DELETE FROM tenants WHERE id = p_tenant_id;
    DELETE FROM users u
    WHERE u.id = ANY (coalesce(v_user_ids, '{}'))
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM platform_admins a WHERE a.user_id = u.id);
    PERFORM set_config('app.purge_tenant', '', true);
  END
  $$;

-- Retention of the transactional outbox.
CREATE FUNCTION purge_processed_outbox_events(p_older_than interval) RETURNS bigint
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
    WITH deleted AS (
      DELETE FROM outbox_events WHERE status = 'DONE' AND processed_at < now() - p_older_than RETURNING 1
    )
    SELECT count(*) FROM deleted
  $$;

-- Retention of in-app notifications that were already read.
CREATE FUNCTION purge_read_notifications(p_older_than interval) RETURNS bigint
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
    WITH deleted AS (
      DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < now() - p_older_than RETURNING 1
    )
    SELECT count(*) FROM deleted
  $$;

ALTER FUNCTION purge_tenant(uuid) OWNER TO app_platform;
ALTER FUNCTION purge_processed_outbox_events(interval) OWNER TO app_platform;
ALTER FUNCTION purge_read_notifications(interval) OWNER TO app_platform;
REVOKE ALL ON FUNCTION purge_tenant(uuid), purge_processed_outbox_events(interval), purge_read_notifications(interval)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_tenant(uuid), purge_processed_outbox_events(interval), purge_read_notifications(interval)
  TO app_platform;
