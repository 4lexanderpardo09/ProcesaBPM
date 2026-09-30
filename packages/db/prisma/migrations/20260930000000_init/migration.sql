-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED', 'DELETED');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "user_token_type" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'INVITATION', 'EMAIL_CHANGE');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "system_role" AS ENUM ('ADMIN', 'SUPERVISOR', 'AGENT', 'REQUESTER');

-- CreateEnum
CREATE TYPE "announcement_type" AS ENUM ('MAINTENANCE', 'RELEASE_NOTES', 'INFO');

-- CreateEnum
CREATE TYPE "workflow_version_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "step_type" AS ENUM ('START', 'TASK', 'APPROVAL', 'CONDITION', 'DECISION', 'DOCUMENT', 'SIGNATURE', 'EXPORT', 'NOTIFICATION', 'WEBHOOK', 'CALCULATOR', 'WAIT', 'END');

-- CreateEnum
CREATE TYPE "assignment_mode" AS ENUM ('NONE', 'POSITION', 'USERS', 'GROUP', 'CREATOR', 'APPROVER', 'POOL', 'PARALLEL', 'RANDOM_DISPATCH');

-- CreateEnum
CREATE TYPE "site_scope" AS ENUM ('SAME_SITE', 'PARENT_SITE', 'ANY_SITE');

-- CreateEnum
CREATE TYPE "close_rule" AS ENUM ('NOT_ALLOWED', 'ALLOWED', 'REQUIRED');

-- CreateEnum
CREATE TYPE "sla_unit" AS ENUM ('BUSINESS_HOURS', 'BUSINESS_DAYS');

-- CreateEnum
CREATE TYPE "deadline_type" AS ENUM ('SLA', 'CUTOFF');

-- CreateEnum
CREATE TYPE "participant_type" AS ENUM ('USER', 'POSITION', 'GROUP', 'DEPARTMENT', 'COMPANY', 'SITE');

-- CreateEnum
CREATE TYPE "signer_type" AS ENUM ('USER', 'POSITION', 'APPROVER', 'CREATOR', 'STEP_ASSIGNEE');

-- CreateEnum
CREATE TYPE "transition_type" AS ENUM ('DECISION', 'CONDITION', 'DEFAULT', 'SYSTEM_ONLY');

-- CreateEnum
CREATE TYPE "field_type" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'SELECT', 'MULTI_SELECT', 'DATE', 'DATETIME', 'DAYS', 'SITE', 'USER', 'TABLE', 'FILE', 'FORMULA', 'CALCULATOR');

-- CreateEnum
CREATE TYPE "capture_stage" AS ENUM ('CREATION', 'STEP', 'BOTH');

-- CreateEnum
CREATE TYPE "amount_rule_action" AS ENUM ('BLOCK', 'WARN', 'EXTRA_APPROVAL');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "assignee_type" AS ENUM ('PRIMARY', 'POOL', 'PARALLEL', 'INCIDENT');

-- CreateEnum
CREATE TYPE "ticket_event_type" AS ENUM ('CREATED', 'TRANSITIONED', 'ASSIGNED', 'REASSIGNED', 'COMMENTED', 'INCIDENT_OPENED', 'INCIDENT_RESOLVED', 'CLOSED', 'REOPENED', 'ERROR_REPORTED', 'AMOUNT_WARNING', 'FIELDS_UPDATED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "sla_result" AS ENUM ('ON_TIME', 'LATE');

-- CreateEnum
CREATE TYPE "parallel_task_status" AS ENUM ('PENDING', 'SIGNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "incident_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "file_origin" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('PENDING', 'CONFIRMED', 'DELETED');

-- CreateEnum
CREATE TYPE "ticket_document_role" AS ENUM ('ATTACHMENT', 'CLOSING', 'STEP_DOCUMENT', 'MAIN_DOCUMENT', 'SIGNATURE', 'TABLE_FIELD');

-- CreateEnum
CREATE TYPE "pdf_field_mode" AS ENUM ('COORDINATES', 'ACROFORM');

-- CreateEnum
CREATE TYPE "workflow_document_kind" AS ENUM ('DESIGNED', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "document_moment" AS ENUM ('CREATION', 'EACH_STEP', 'CLOSING');

-- CreateEnum
CREATE TYPE "export_format" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "export_trigger" AS ENUM ('TRANSITION', 'CLOSING');

-- CreateEnum
CREATE TYPE "export_frequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'EVERY_N_DAYS');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_TRANSITIONED', 'TICKET_COMMENTED', 'TICKET_CLOSED', 'TICKET_REOPENED', 'INCIDENT_OPENED', 'INCIDENT_RESOLVED', 'SLA_WARNING', 'SLA_OVERDUE', 'OBSERVER_UPDATE', 'STORAGE_QUOTA', 'SYSTEM');

-- CreateEnum
CREATE TYPE "export_column_source" AS ENUM ('FIELD', 'DERIVED', 'CONSTANT', 'COMPANY', 'REQUESTER', 'TABLE_SUM', 'CATALOG', 'SEQUENCE', 'CUTOFF_DATE', 'TICKET_DATE');

-- CreateEnum
CREATE TYPE "export_value_format" AS ENUM ('TRIM', 'UPPER', 'INTEGER', 'INTEGER_OR_EMPTY', 'DECIMAL_2', 'DATE_DMY');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storage_base_bytes" BIGINT NOT NULL,
    "storage_per_user_bytes" BIGINT NOT NULL,
    "storage_grace_percent" INTEGER NOT NULL DEFAULT 5,
    "max_users" INTEGER,
    "features" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" SMALLINT NOT NULL DEFAULT 2,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "time_zone" TEXT NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "country_holidays" (
    "country_code" CHAR(2) NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "country_holidays_pkey" PRIMARY KEY ("country_code","date")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "document_number" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "locale" TEXT NOT NULL DEFAULT 'es-CO',
    "time_zone" TEXT,
    "mfa_secret_encrypted" BYTEA,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "active_tenant_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "type" "user_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_tenant_id" UUID,
    "payload" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "platform_announcements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" "announcement_type" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "blocks_login" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "plan_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "extra_storage_bytes" BIGINT NOT NULL DEFAULT 0,
    "db_cluster" TEXT NOT NULL DEFAULT 'main',
    "primary_color" TEXT,
    "logo_file_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "purge_after" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_usage" (
    "tenant_id" UUID NOT NULL,
    "bytes_used" BIGINT NOT NULL DEFAULT 0,
    "bytes_reserved" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_usage_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenant_id","name")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "memberships" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "position_id" UUID,
    "department_id" UUID,
    "site_id" UUID,
    "status" "membership_status" NOT NULL DEFAULT 'INVITED',
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "signature_file_id" UUID,
    "joined_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("tenant_id","user_id")
);

-- CreateTable
CREATE TABLE "membership_companies" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "membership_companies_pkey" PRIMARY KEY ("tenant_id","user_id","company_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system_role" "system_role",
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "conditions" JSONB,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("tenant_id","role_id","permission_id")
);

-- CreateTable
CREATE TABLE "groups" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("tenant_id","group_id","user_id")
);

-- CreateTable
CREATE TABLE "companies" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "country_code" CHAR(2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "calendar_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "departments" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "positions" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "site_levels" (
    "tenant_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "site_levels_pkey" PRIMARY KEY ("tenant_id","level")
);

-- CreateTable
CREATE TABLE "sites" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "parent_id" UUID,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_central" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "calendars" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "country_code" CHAR(2),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "calendar_working_hours" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "calendar_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,

    CONSTRAINT "calendar_working_hours_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "calendar_holidays" (
    "tenant_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "calendar_holidays_pkey" PRIMARY KEY ("tenant_id","calendar_id","date")
);

-- CreateTable
CREATE TABLE "approval_group_types" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_group_types_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "approval_groups" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type_id" UUID NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_groups_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "approval_group_approvers" (
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "approval_group_approvers_pkey" PRIMARY KEY ("tenant_id","group_id","user_id")
);

-- CreateTable
CREATE TABLE "approval_group_members" (
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "company_id" UUID,
    "user_id" UUID NOT NULL,

    CONSTRAINT "approval_group_members_pkey" PRIMARY KEY ("tenant_id","group_id","user_id")
);

-- CreateTable
CREATE TABLE "delegations" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "priorities" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "priorities_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "categories" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "category_companies" (
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "category_companies_pkey" PRIMARY KEY ("tenant_id","category_id","company_id")
);

-- CreateTable
CREATE TABLE "category_departments" (
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,

    CONSTRAINT "category_departments_pkey" PRIMARY KEY ("tenant_id","category_id","department_id")
);

-- CreateTable
CREATE TABLE "subcategories" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "category_id" UUID NOT NULL,
    "default_priority_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcategories_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subcategory_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "workflow_observers" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "participant_type" "participant_type" NOT NULL,
    "user_id" UUID,
    "position_id" UUID,
    "group_id" UUID,

    CONSTRAINT "workflow_observers_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "workflow_version_status" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "steps" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" UUID NOT NULL,
    "type" "step_type" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assignment_mode" "assignment_mode" NOT NULL DEFAULT 'NONE',
    "manual_selection" BOOLEAN NOT NULL DEFAULT false,
    "site_scope" "site_scope" NOT NULL DEFAULT 'SAME_SITE',
    "position_id" UUID,
    "approval_group_type_id" UUID,
    "approval_level" SMALLINT,
    "close_rule" "close_rule" NOT NULL DEFAULT 'NOT_ALLOWED',
    "sla_value" INTEGER,
    "sla_unit" "sla_unit",
    "deadline_type" "deadline_type" NOT NULL DEFAULT 'SLA',
    "deadline_field_code" TEXT,
    "deadline_business_days" INTEGER,
    "max_loops" INTEGER,
    "dispatch_interval_min" INTEGER,
    "allows_batch" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "ui_x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ui_y" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "steps_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "step_runtime_states" (
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "last_dispatch_at" TIMESTAMPTZ(3),
    "last_assigned_user_id" UUID,

    CONSTRAINT "step_runtime_states_pkey" PRIMARY KEY ("tenant_id","step_id")
);

-- CreateTable
CREATE TABLE "step_candidates" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "step_id" UUID NOT NULL,
    "participant_type" "participant_type" NOT NULL,
    "user_id" UUID,
    "position_id" UUID,
    "group_id" UUID,

    CONSTRAINT "step_candidates_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "step_initiators" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "step_id" UUID NOT NULL,
    "participant_type" "participant_type" NOT NULL,
    "user_id" UUID,
    "position_id" UUID,
    "group_id" UUID,
    "department_id" UUID,
    "company_id" UUID,
    "site_id" UUID,

    CONSTRAINT "step_initiators_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "step_sla_overrides" (
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sla_value" INTEGER NOT NULL,
    "sla_unit" "sla_unit" NOT NULL,

    CONSTRAINT "step_sla_overrides_pkey" PRIMARY KEY ("tenant_id","step_id","company_id")
);

-- CreateTable
CREATE TABLE "step_signers" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "step_id" UUID NOT NULL,
    "signer_type" "signer_type" NOT NULL,
    "user_id" UUID,
    "position_id" UUID,
    "label" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "step_signers_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "step_files" (
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "step_files_pkey" PRIMARY KEY ("tenant_id","step_id","file_id")
);

-- CreateTable
CREATE TABLE "transitions" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" UUID NOT NULL,
    "from_step_id" UUID NOT NULL,
    "to_step_id" UUID NOT NULL,
    "type" "transition_type" NOT NULL DEFAULT 'DECISION',
    "label" TEXT NOT NULL,
    "condition" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "ui_points" JSONB,

    CONSTRAINT "transitions_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "fields" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "field_type" NOT NULL,
    "capture" "capture_stage" NOT NULL DEFAULT 'BOTH',
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_read_only" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "data_source" JSONB,

    CONSTRAINT "fields_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "amount_rules" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" UUID NOT NULL,
    "step_id" UUID,
    "position_id" UUID,
    "company_id" UUID,
    "field_code" TEXT NOT NULL,
    "row_type_value" TEXT,
    "amount_column" TEXT,
    "type_column" TEXT,
    "max_amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "action" "amount_rule_action" NOT NULL,
    "approval_step_id" UUID,
    "message" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "amount_rules_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "company_cutoffs" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cutoff_day" SMALLINT NOT NULL,
    "grace_business_days" SMALLINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "company_cutoffs_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "source_file_name" TEXT,
    "loaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "dataset_rows" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "dataset_id" UUID NOT NULL,
    "lookup_key" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "dataset_rows_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "calculator_configs" (
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculator_configs_pkey" PRIMARY KEY ("tenant_id","code")
);

-- CreateTable
CREATE TABLE "tickets" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" BIGINT NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "subcategory_id" UUID NOT NULL,
    "priority_id" UUID,
    "company_id" UUID NOT NULL,
    "department_id" UUID,
    "site_id" UUID,
    "creator_id" UUID NOT NULL,
    "registered_by_id" UUID,
    "title" TEXT NOT NULL,
    "description_html" TEXT NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'OPEN',
    "current_step_id" UUID,
    "current_loop" INTEGER NOT NULL DEFAULT 1,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "forced_close" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "search_vector" tsvector,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_assignees" (
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "assignee_type" NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_assignees_pkey" PRIMARY KEY ("tenant_id","ticket_id","user_id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "type" "ticket_event_type" NOT NULL,
    "step_id" UUID,
    "transition_id" UUID,
    "loop" INTEGER NOT NULL DEFAULT 1,
    "actor_id" UUID,
    "assignee_id" UUID,
    "comment_html" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_step_visits" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "loop" INTEGER NOT NULL DEFAULT 1,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_at" TIMESTAMPTZ(3),
    "exit_transition_id" UUID,
    "sla_value" INTEGER,
    "sla_unit" "sla_unit",
    "calendar_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "paused_minutes" INTEGER NOT NULL DEFAULT 0,
    "business_minutes" INTEGER,
    "result" "sla_result",

    CONSTRAINT "ticket_step_visits_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_sla_clocks" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "loop" INTEGER NOT NULL DEFAULT 1,
    "company_id" UUID NOT NULL,
    "responsible_id" UUID,
    "sla_value" INTEGER,
    "sla_unit" "sla_unit",
    "calendar_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "paused_minutes" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "business_minutes" INTEGER,
    "result" "sla_result",
    "alerted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ticket_sla_clocks_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_field_values" (
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_field_values_pkey" PRIMARY KEY ("tenant_id","ticket_id","field_id")
);

-- CreateTable
CREATE TABLE "ticket_parallel_tasks" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "loop" INTEGER NOT NULL DEFAULT 1,
    "user_id" UUID NOT NULL,
    "status" "parallel_task_status" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_parallel_tasks_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_incidents" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "assigned_to_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "status" "incident_status" NOT NULL DEFAULT 'OPEN',
    "previous_assignee_ids" UUID[],
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "ticket_incidents_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "error_types" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_process_error" BOOLEAN NOT NULL DEFAULT false,
    "forces_close" BOOLEAN NOT NULL DEFAULT false,
    "is_reopening" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "error_types_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "error_subtypes" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "error_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "error_subtypes_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_errors" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "error_type_id" UUID NOT NULL,
    "error_subtype_id" UUID,
    "reporter_id" UUID NOT NULL,
    "responsible_id" UUID NOT NULL,
    "description" TEXT,
    "is_process_error" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_errors_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "tags" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_tags" (
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("tenant_id","ticket_id","tag_id")
);

-- CreateTable
CREATE TABLE "ticket_signatures" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "loop" INTEGER NOT NULL DEFAULT 1,
    "user_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "is_parallel" BOOLEAN NOT NULL DEFAULT false,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_signatures_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "origin" "file_origin" NOT NULL,
    "status" "file_status" NOT NULL DEFAULT 'PENDING',
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "ticket_documents" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "role" "ticket_document_role" NOT NULL,
    "event_id" UUID,
    "step_id" UUID,
    "field_code" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ticket_documents_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "pdf_formats" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "design" JSONB NOT NULL,
    "file_name_pattern" TEXT,
    "updated_by_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_formats_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "pdf_templates" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "company_id" UUID,
    "file_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pages" JSONB NOT NULL,
    "has_acroform" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_templates_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "pdf_template_fields" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "template_id" UUID NOT NULL,
    "mode" "pdf_field_mode" NOT NULL,
    "field_code" TEXT,
    "expression" TEXT,
    "acroform_name" TEXT,
    "page" SMALLINT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "font_size" DOUBLE PRECISION,
    "max_width" DOUBLE PRECISION,
    "align" TEXT,

    CONSTRAINT "pdf_template_fields_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "pdf_template_signatures" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "template_id" UUID NOT NULL,
    "mode" "pdf_field_mode" NOT NULL,
    "step_name" TEXT NOT NULL,
    "signer_type" "signer_type" NOT NULL,
    "signer_label" TEXT,
    "acroform_name" TEXT,
    "page" SMALLINT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,

    CONSTRAINT "pdf_template_signatures_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "workflow_documents" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "company_id" UUID,
    "kind" "workflow_document_kind" NOT NULL,
    "format_id" UUID,
    "template_id" UUID,
    "moment" "document_moment" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflow_documents_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "export_definitions" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workflow_id" UUID NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "format" "export_format" NOT NULL DEFAULT 'XLSX',
    "sheet_name" TEXT NOT NULL DEFAULT 'Export',
    "delimiter" TEXT NOT NULL DEFAULT ';',
    "trigger" "export_trigger" NOT NULL,
    "transition_label" TEXT,
    "filter" JSONB,
    "group_by" TEXT,
    "cutoff_time" TIME(0) NOT NULL,
    "frequency" "export_frequency" NOT NULL DEFAULT 'DAILY',
    "weekday" SMALLINT,
    "month_day" SMALLINT,
    "interval_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_definitions_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "export_columns" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "definition_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "header" TEXT NOT NULL,
    "source_type" "export_column_source" NOT NULL,
    "source_ref" TEXT,
    "format" "export_value_format",

    CONSTRAINT "export_columns_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "export_catalog_entries" (
    "tenant_id" UUID NOT NULL,
    "catalog" TEXT NOT NULL,
    "input_value" TEXT NOT NULL,
    "output_value" TEXT NOT NULL,

    CONSTRAINT "export_catalog_entries_pkey" PRIMARY KEY ("tenant_id","catalog","input_value")
);

-- CreateTable
CREATE TABLE "export_cutoffs" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "definition_id" UUID NOT NULL,
    "cutoff_date" DATE NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_id" UUID,
    "file_id" UUID,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "export_cutoffs_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "export_lines" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "definition_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" UUID,
    "cutoff_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_lines_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "ticket_id" UUID,
    "type" "notification_type" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("tenant_id","user_id","type")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "url" TEXT NOT NULL,
    "secret_encrypted" BYTEA NOT NULL,
    "events" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "webhook_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "text_templates" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_templates_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "text_template_shares" (
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "text_template_shares_pkey" PRIMARY KEY ("tenant_id","template_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "countries_currency_code_idx" ON "countries"("currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_action_subject_key" ON "permissions"("action", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_type_idx" ON "user_tokens"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_country_code_idx" ON "tenants"("country_code");

-- CreateIndex
CREATE INDEX "tenants_plan_id_idx" ON "tenants"("plan_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_role_id_idx" ON "memberships"("tenant_id", "role_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_position_id_idx" ON "memberships"("tenant_id", "position_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_site_id_idx" ON "memberships"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_department_id_idx" ON "memberships"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_signature_file_id_idx" ON "memberships"("tenant_id", "signature_file_id");

-- CreateIndex
CREATE INDEX "membership_companies_tenant_id_company_id_idx" ON "membership_companies"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_tenant_id_name_key" ON "groups"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "group_members_tenant_id_user_id_idx" ON "group_members"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "companies_country_code_idx" ON "companies"("country_code");

-- CreateIndex
CREATE INDEX "companies_currency_code_idx" ON "companies"("currency_code");

-- CreateIndex
CREATE INDEX "companies_tenant_id_calendar_id_idx" ON "companies"("tenant_id", "calendar_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_name_key" ON "companies"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_name_key" ON "departments"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "positions_tenant_id_name_key" ON "positions"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "sites_tenant_id_parent_id_idx" ON "sites"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_parent_id_name_key" ON "sites"("tenant_id", "parent_id", "name");

-- CreateIndex
CREATE INDEX "calendars_country_code_idx" ON "calendars"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "calendars_tenant_id_name_key" ON "calendars"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "calendar_working_hours_tenant_id_calendar_id_weekday_idx" ON "calendar_working_hours"("tenant_id", "calendar_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "approval_group_types_tenant_id_name_key" ON "approval_group_types"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "approval_groups_tenant_id_company_id_idx" ON "approval_groups"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_groups_tenant_id_type_id_id_key" ON "approval_groups"("tenant_id", "type_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_groups_tenant_id_name_key" ON "approval_groups"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "approval_group_approvers_tenant_id_user_id_idx" ON "approval_group_approvers"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_group_approvers_tenant_id_group_id_position_key" ON "approval_group_approvers"("tenant_id", "group_id", "position");

-- CreateIndex
CREATE INDEX "approval_group_members_tenant_id_company_id_idx" ON "approval_group_members"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "approval_group_members_tenant_id_type_id_group_id_idx" ON "approval_group_members"("tenant_id", "type_id", "group_id");

-- CreateIndex
CREATE INDEX "approval_group_members_tenant_id_type_id_idx" ON "approval_group_members"("tenant_id", "type_id");

-- CreateIndex
CREATE INDEX "approval_group_members_tenant_id_user_id_idx" ON "approval_group_members"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_members_one_group" ON "approval_group_members"("tenant_id", "type_id", "company_id", "user_id");

-- CreateIndex
CREATE INDEX "delegations_tenant_id_from_user_id_starts_at_ends_at_idx" ON "delegations"("tenant_id", "from_user_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "delegations_tenant_id_to_user_id_idx" ON "delegations"("tenant_id", "to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "priorities_tenant_id_name_key" ON "priorities"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_name_key" ON "categories"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "category_companies_tenant_id_company_id_idx" ON "category_companies"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "category_departments_tenant_id_department_id_idx" ON "category_departments"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "subcategories_tenant_id_default_priority_id_idx" ON "subcategories"("tenant_id", "default_priority_id");

-- CreateIndex
CREATE UNIQUE INDEX "subcategories_tenant_id_category_id_name_key" ON "subcategories"("tenant_id", "category_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_tenant_id_subcategory_id_key" ON "workflows"("tenant_id", "subcategory_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_tenant_id_subcategory_id_id_key" ON "workflows"("tenant_id", "subcategory_id", "id");

-- CreateIndex
CREATE INDEX "workflow_observers_tenant_id_workflow_id_idx" ON "workflow_observers"("tenant_id", "workflow_id");

-- CreateIndex
CREATE INDEX "workflow_observers_tenant_id_group_id_idx" ON "workflow_observers"("tenant_id", "group_id");

-- CreateIndex
CREATE INDEX "workflow_observers_tenant_id_position_id_idx" ON "workflow_observers"("tenant_id", "position_id");

-- CreateIndex
CREATE INDEX "workflow_observers_tenant_id_user_id_idx" ON "workflow_observers"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "workflow_versions_tenant_id_published_by_id_idx" ON "workflow_versions"("tenant_id", "published_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_tenant_id_workflow_id_number_key" ON "workflow_versions"("tenant_id", "workflow_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_tenant_id_workflow_id_id_key" ON "workflow_versions"("tenant_id", "workflow_id", "id");

-- CreateIndex
CREATE INDEX "steps_tenant_id_version_id_idx" ON "steps"("tenant_id", "version_id");

-- CreateIndex
CREATE INDEX "steps_tenant_id_approval_group_type_id_idx" ON "steps"("tenant_id", "approval_group_type_id");

-- CreateIndex
CREATE INDEX "steps_tenant_id_position_id_idx" ON "steps"("tenant_id", "position_id");

-- CreateIndex
CREATE UNIQUE INDEX "steps_tenant_id_version_id_id_key" ON "steps"("tenant_id", "version_id", "id");

-- CreateIndex
CREATE INDEX "step_runtime_states_tenant_id_last_assigned_user_id_idx" ON "step_runtime_states"("tenant_id", "last_assigned_user_id");

-- CreateIndex
CREATE INDEX "step_candidates_tenant_id_step_id_idx" ON "step_candidates"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "step_candidates_tenant_id_group_id_idx" ON "step_candidates"("tenant_id", "group_id");

-- CreateIndex
CREATE INDEX "step_candidates_tenant_id_position_id_idx" ON "step_candidates"("tenant_id", "position_id");

-- CreateIndex
CREATE INDEX "step_candidates_tenant_id_user_id_idx" ON "step_candidates"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "step_initiators_tenant_id_step_id_idx" ON "step_initiators"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "step_initiators_tenant_id_company_id_idx" ON "step_initiators"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "step_initiators_tenant_id_department_id_idx" ON "step_initiators"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "step_initiators_tenant_id_group_id_idx" ON "step_initiators"("tenant_id", "group_id");

-- CreateIndex
CREATE INDEX "step_initiators_tenant_id_position_id_idx" ON "step_initiators"("tenant_id", "position_id");

-- CreateIndex
CREATE INDEX "step_initiators_tenant_id_site_id_idx" ON "step_initiators"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "step_initiators_tenant_id_user_id_idx" ON "step_initiators"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "step_sla_overrides_tenant_id_company_id_idx" ON "step_sla_overrides"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "step_signers_tenant_id_step_id_idx" ON "step_signers"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "step_signers_tenant_id_position_id_idx" ON "step_signers"("tenant_id", "position_id");

-- CreateIndex
CREATE INDEX "step_signers_tenant_id_user_id_idx" ON "step_signers"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "step_files_tenant_id_file_id_idx" ON "step_files"("tenant_id", "file_id");

-- CreateIndex
CREATE INDEX "transitions_tenant_id_from_step_id_idx" ON "transitions"("tenant_id", "from_step_id");

-- CreateIndex
CREATE INDEX "transitions_tenant_id_to_step_id_idx" ON "transitions"("tenant_id", "to_step_id");

-- CreateIndex
CREATE INDEX "transitions_tenant_id_version_id_from_step_id_idx" ON "transitions"("tenant_id", "version_id", "from_step_id");

-- CreateIndex
CREATE INDEX "transitions_tenant_id_version_id_to_step_id_idx" ON "transitions"("tenant_id", "version_id", "to_step_id");

-- CreateIndex
CREATE INDEX "transitions_tenant_id_version_id_idx" ON "transitions"("tenant_id", "version_id");

-- CreateIndex
CREATE INDEX "fields_tenant_id_step_id_idx" ON "fields"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "fields_tenant_id_version_id_step_id_idx" ON "fields"("tenant_id", "version_id", "step_id");

-- CreateIndex
CREATE UNIQUE INDEX "fields_tenant_id_version_id_code_key" ON "fields"("tenant_id", "version_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fields_tenant_id_version_id_id_key" ON "fields"("tenant_id", "version_id", "id");

-- CreateIndex
CREATE INDEX "amount_rules_tenant_id_version_id_idx" ON "amount_rules"("tenant_id", "version_id");

-- CreateIndex
CREATE INDEX "amount_rules_currency_code_idx" ON "amount_rules"("currency_code");

-- CreateIndex
CREATE INDEX "amount_rules_tenant_id_approval_step_id_idx" ON "amount_rules"("tenant_id", "approval_step_id");

-- CreateIndex
CREATE INDEX "amount_rules_tenant_id_company_id_idx" ON "amount_rules"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "amount_rules_tenant_id_position_id_idx" ON "amount_rules"("tenant_id", "position_id");

-- CreateIndex
CREATE INDEX "amount_rules_tenant_id_step_id_idx" ON "amount_rules"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "company_cutoffs_tenant_id_company_id_idx" ON "company_cutoffs"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_cutoffs_tenant_id_workflow_id_company_id_cutoff_day_key" ON "company_cutoffs"("tenant_id", "workflow_id", "company_id", "cutoff_day");

-- CreateIndex
CREATE INDEX "datasets_tenant_id_workflow_id_idx" ON "datasets"("tenant_id", "workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_tenant_id_name_key" ON "datasets"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "dataset_rows_tenant_id_dataset_id_lookup_key_idx" ON "dataset_rows"("tenant_id", "dataset_id", "lookup_key");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_status_created_at_idx" ON "tickets"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_tenant_id_creator_id_created_at_idx" ON "tickets"("tenant_id", "creator_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_tenant_id_current_step_id_idx" ON "tickets"("tenant_id", "current_step_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_subcategory_id_created_at_idx" ON "tickets"("tenant_id", "subcategory_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_tenant_id_company_id_created_at_idx" ON "tickets"("tenant_id", "company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_tenant_id_closed_by_id_idx" ON "tickets"("tenant_id", "closed_by_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_creator_id_company_id_idx" ON "tickets"("tenant_id", "creator_id", "company_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_department_id_idx" ON "tickets"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_priority_id_idx" ON "tickets"("tenant_id", "priority_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_registered_by_id_idx" ON "tickets"("tenant_id", "registered_by_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_site_id_idx" ON "tickets"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_subcategory_id_workflow_id_idx" ON "tickets"("tenant_id", "subcategory_id", "workflow_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_workflow_id_workflow_version_id_idx" ON "tickets"("tenant_id", "workflow_id", "workflow_version_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_workflow_version_id_current_step_id_idx" ON "tickets"("tenant_id", "workflow_version_id", "current_step_id");

-- CreateIndex
CREATE INDEX "tickets_search" ON "tickets" USING GIN ("search_vector");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_tenant_id_number_key" ON "tickets"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_tenant_id_id_workflow_version_id_key" ON "tickets"("tenant_id", "id", "workflow_version_id");

-- CreateIndex
CREATE INDEX "ticket_assignees_tenant_id_user_id_idx" ON "ticket_assignees"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "ticket_events_tenant_id_ticket_id_created_at_idx" ON "ticket_events"("tenant_id", "ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_events_tenant_id_actor_id_created_at_idx" ON "ticket_events"("tenant_id", "actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ticket_events_tenant_id_assignee_id_idx" ON "ticket_events"("tenant_id", "assignee_id");

-- CreateIndex
CREATE INDEX "ticket_events_tenant_id_step_id_idx" ON "ticket_events"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "ticket_events_tenant_id_transition_id_idx" ON "ticket_events"("tenant_id", "transition_id");

-- CreateIndex
CREATE INDEX "ticket_step_visits_tenant_id_calendar_id_idx" ON "ticket_step_visits"("tenant_id", "calendar_id");

-- CreateIndex
CREATE INDEX "ticket_step_visits_tenant_id_exit_transition_id_idx" ON "ticket_step_visits"("tenant_id", "exit_transition_id");

-- CreateIndex
CREATE INDEX "ticket_step_visits_tenant_id_step_id_idx" ON "ticket_step_visits"("tenant_id", "step_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_step_visits_tenant_id_ticket_id_step_id_loop_key" ON "ticket_step_visits"("tenant_id", "ticket_id", "step_id", "loop");

-- CreateIndex
CREATE INDEX "ticket_sla_clocks_tenant_id_ticket_id_idx" ON "ticket_sla_clocks"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "ticket_sla_clocks_tenant_id_responsible_id_completed_at_idx" ON "ticket_sla_clocks"("tenant_id", "responsible_id", "completed_at");

-- CreateIndex
CREATE INDEX "ticket_sla_clocks_tenant_id_company_id_idx" ON "ticket_sla_clocks"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ticket_sla_clocks_tenant_id_step_id_idx" ON "ticket_sla_clocks"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "ticket_sla_clocks_tenant_id_visit_id_idx" ON "ticket_sla_clocks"("tenant_id", "visit_id");

-- CreateIndex
CREATE INDEX "ticket_field_values_tenant_id_ticket_id_workflow_version_id_idx" ON "ticket_field_values"("tenant_id", "ticket_id", "workflow_version_id");

-- CreateIndex
CREATE INDEX "ticket_field_values_tenant_id_updated_by_id_idx" ON "ticket_field_values"("tenant_id", "updated_by_id");

-- CreateIndex
CREATE INDEX "ticket_field_values_tenant_id_workflow_version_id_field_id_idx" ON "ticket_field_values"("tenant_id", "workflow_version_id", "field_id");

-- CreateIndex
CREATE INDEX "ticket_parallel_tasks_tenant_id_step_id_idx" ON "ticket_parallel_tasks"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "ticket_parallel_tasks_tenant_id_user_id_idx" ON "ticket_parallel_tasks"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_parallel_tasks_tenant_id_ticket_id_step_id_loop_user_key" ON "ticket_parallel_tasks"("tenant_id", "ticket_id", "step_id", "loop", "user_id");

-- CreateIndex
CREATE INDEX "ticket_incidents_tenant_id_ticket_id_status_idx" ON "ticket_incidents"("tenant_id", "ticket_id", "status");

-- CreateIndex
CREATE INDEX "ticket_incidents_tenant_id_assigned_to_id_idx" ON "ticket_incidents"("tenant_id", "assigned_to_id");

-- CreateIndex
CREATE INDEX "ticket_incidents_tenant_id_created_by_id_idx" ON "ticket_incidents"("tenant_id", "created_by_id");

-- CreateIndex
CREATE INDEX "ticket_incidents_tenant_id_step_id_idx" ON "ticket_incidents"("tenant_id", "step_id");

-- CreateIndex
CREATE UNIQUE INDEX "error_types_tenant_id_name_key" ON "error_types"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "error_subtypes_tenant_id_error_type_id_name_key" ON "error_subtypes"("tenant_id", "error_type_id", "name");

-- CreateIndex
CREATE INDEX "ticket_errors_tenant_id_ticket_id_idx" ON "ticket_errors"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "ticket_errors_tenant_id_responsible_id_created_at_idx" ON "ticket_errors"("tenant_id", "responsible_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ticket_errors_tenant_id_error_subtype_id_idx" ON "ticket_errors"("tenant_id", "error_subtype_id");

-- CreateIndex
CREATE INDEX "ticket_errors_tenant_id_error_type_id_idx" ON "ticket_errors"("tenant_id", "error_type_id");

-- CreateIndex
CREATE INDEX "ticket_errors_tenant_id_reporter_id_idx" ON "ticket_errors"("tenant_id", "reporter_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenant_id_owner_id_name_key" ON "tags"("tenant_id", "owner_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenant_id_id_owner_id_key" ON "tags"("tenant_id", "id", "owner_id");

-- CreateIndex
CREATE INDEX "ticket_tags_tenant_id_user_id_idx" ON "ticket_tags"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "ticket_tags_tenant_id_tag_id_user_id_idx" ON "ticket_tags"("tenant_id", "tag_id", "user_id");

-- CreateIndex
CREATE INDEX "ticket_signatures_tenant_id_ticket_id_step_id_idx" ON "ticket_signatures"("tenant_id", "ticket_id", "step_id");

-- CreateIndex
CREATE INDEX "ticket_signatures_tenant_id_file_id_idx" ON "ticket_signatures"("tenant_id", "file_id");

-- CreateIndex
CREATE INDEX "ticket_signatures_tenant_id_step_id_idx" ON "ticket_signatures"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "ticket_signatures_tenant_id_user_id_idx" ON "ticket_signatures"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "stored_files_tenant_id_status_created_at_idx" ON "stored_files"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "stored_files_tenant_id_company_id_idx" ON "stored_files"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "stored_files_tenant_id_uploaded_by_id_idx" ON "stored_files"("tenant_id", "uploaded_by_id");

-- CreateIndex
CREATE INDEX "ticket_documents_tenant_id_ticket_id_role_idx" ON "ticket_documents"("tenant_id", "ticket_id", "role");

-- CreateIndex
CREATE INDEX "ticket_documents_tenant_id_event_id_idx" ON "ticket_documents"("tenant_id", "event_id");

-- CreateIndex
CREATE INDEX "ticket_documents_tenant_id_file_id_idx" ON "ticket_documents"("tenant_id", "file_id");

-- CreateIndex
CREATE INDEX "ticket_documents_tenant_id_step_id_idx" ON "ticket_documents"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "pdf_formats_tenant_id_updated_by_id_idx" ON "pdf_formats"("tenant_id", "updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_formats_tenant_id_workflow_id_name_key" ON "pdf_formats"("tenant_id", "workflow_id", "name");

-- CreateIndex
CREATE INDEX "pdf_templates_tenant_id_company_id_idx" ON "pdf_templates"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "pdf_templates_tenant_id_file_id_idx" ON "pdf_templates"("tenant_id", "file_id");

-- CreateIndex
CREATE INDEX "pdf_templates_tenant_id_workflow_id_idx" ON "pdf_templates"("tenant_id", "workflow_id");

-- CreateIndex
CREATE INDEX "pdf_template_fields_tenant_id_template_id_idx" ON "pdf_template_fields"("tenant_id", "template_id");

-- CreateIndex
CREATE INDEX "pdf_template_signatures_tenant_id_template_id_idx" ON "pdf_template_signatures"("tenant_id", "template_id");

-- CreateIndex
CREATE INDEX "workflow_documents_tenant_id_workflow_id_idx" ON "workflow_documents"("tenant_id", "workflow_id");

-- CreateIndex
CREATE INDEX "workflow_documents_tenant_id_company_id_idx" ON "workflow_documents"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "workflow_documents_tenant_id_format_id_idx" ON "workflow_documents"("tenant_id", "format_id");

-- CreateIndex
CREATE INDEX "workflow_documents_tenant_id_template_id_idx" ON "workflow_documents"("tenant_id", "template_id");

-- CreateIndex
CREATE INDEX "export_definitions_tenant_id_company_id_idx" ON "export_definitions"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "export_definitions_tenant_id_workflow_id_idx" ON "export_definitions"("tenant_id", "workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_definitions_tenant_id_name_key" ON "export_definitions"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "export_columns_tenant_id_definition_id_sort_order_key" ON "export_columns"("tenant_id", "definition_id", "sort_order");

-- CreateIndex
CREATE INDEX "export_cutoffs_tenant_id_definition_id_cutoff_date_idx" ON "export_cutoffs"("tenant_id", "definition_id", "cutoff_date");

-- CreateIndex
CREATE INDEX "export_cutoffs_tenant_id_file_id_idx" ON "export_cutoffs"("tenant_id", "file_id");

-- CreateIndex
CREATE INDEX "export_cutoffs_tenant_id_generated_by_id_idx" ON "export_cutoffs"("tenant_id", "generated_by_id");

-- CreateIndex
CREATE INDEX "export_lines_tenant_id_definition_id_cutoff_id_idx" ON "export_lines"("tenant_id", "definition_id", "cutoff_id");

-- CreateIndex
CREATE INDEX "export_lines_tenant_id_confirmed_by_id_idx" ON "export_lines"("tenant_id", "confirmed_by_id");

-- CreateIndex
CREATE INDEX "export_lines_tenant_id_cutoff_id_idx" ON "export_lines"("tenant_id", "cutoff_id");

-- CreateIndex
CREATE INDEX "export_lines_tenant_id_ticket_id_idx" ON "export_lines"("tenant_id", "ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_lines_tenant_id_definition_id_ticket_id_key" ON "export_lines"("tenant_id", "definition_id", "ticket_id");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_created_at_idx" ON "notifications"("tenant_id", "user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_ticket_id_idx" ON "notifications"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenant_id_webhook_id_created_at_idx" ON "webhook_deliveries"("tenant_id", "webhook_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_actor_id_idx" ON "audit_logs"("tenant_id", "actor_id");

-- CreateIndex
CREATE INDEX "text_templates_tenant_id_owner_id_idx" ON "text_templates"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "text_template_shares_tenant_id_user_id_idx" ON "text_template_shares"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_holidays" ADD CONSTRAINT "country_holidays_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_usage" ADD CONSTRAINT "tenant_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_sequences" ADD CONSTRAINT "tenant_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_signature_file_id_fkey" FOREIGN KEY ("tenant_id", "signature_file_id") REFERENCES "stored_files"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_companies" ADD CONSTRAINT "membership_companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_companies" ADD CONSTRAINT "membership_companies_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_companies" ADD CONSTRAINT "membership_companies_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "groups"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_calendar_id_fkey" FOREIGN KEY ("tenant_id", "calendar_id") REFERENCES "calendars"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_levels" ADD CONSTRAINT "site_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "sites"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_working_hours" ADD CONSTRAINT "calendar_working_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_working_hours" ADD CONSTRAINT "calendar_working_hours_tenant_id_calendar_id_fkey" FOREIGN KEY ("tenant_id", "calendar_id") REFERENCES "calendars"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_tenant_id_calendar_id_fkey" FOREIGN KEY ("tenant_id", "calendar_id") REFERENCES "calendars"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_types" ADD CONSTRAINT "approval_group_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_groups" ADD CONSTRAINT "approval_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_groups" ADD CONSTRAINT "approval_groups_tenant_id_type_id_fkey" FOREIGN KEY ("tenant_id", "type_id") REFERENCES "approval_group_types"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_groups" ADD CONSTRAINT "approval_groups_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_approvers" ADD CONSTRAINT "approval_group_approvers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_approvers" ADD CONSTRAINT "approval_group_approvers_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "approval_groups"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_approvers" ADD CONSTRAINT "approval_group_approvers_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_members" ADD CONSTRAINT "approval_group_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_members" ADD CONSTRAINT "approval_group_members_tenant_id_type_id_group_id_fkey" FOREIGN KEY ("tenant_id", "type_id", "group_id") REFERENCES "approval_groups"("tenant_id", "type_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_members" ADD CONSTRAINT "approval_group_members_tenant_id_type_id_fkey" FOREIGN KEY ("tenant_id", "type_id") REFERENCES "approval_group_types"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_members" ADD CONSTRAINT "approval_group_members_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_group_members" ADD CONSTRAINT "approval_group_members_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_id_from_user_id_fkey" FOREIGN KEY ("tenant_id", "from_user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_id_to_user_id_fkey" FOREIGN KEY ("tenant_id", "to_user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priorities" ADD CONSTRAINT "priorities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_companies" ADD CONSTRAINT "category_companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_companies" ADD CONSTRAINT "category_companies_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "categories"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_companies" ADD CONSTRAINT "category_companies_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_departments" ADD CONSTRAINT "category_departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_departments" ADD CONSTRAINT "category_departments_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "categories"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_departments" ADD CONSTRAINT "category_departments_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "categories"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_tenant_id_default_priority_id_fkey" FOREIGN KEY ("tenant_id", "default_priority_id") REFERENCES "priorities"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_subcategory_id_fkey" FOREIGN KEY ("tenant_id", "subcategory_id") REFERENCES "subcategories"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_observers" ADD CONSTRAINT "workflow_observers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_observers" ADD CONSTRAINT "workflow_observers_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_observers" ADD CONSTRAINT "workflow_observers_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_observers" ADD CONSTRAINT "workflow_observers_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_observers" ADD CONSTRAINT "workflow_observers_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "groups"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_published_by_id_fkey" FOREIGN KEY ("tenant_id", "published_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_tenant_id_version_id_fkey" FOREIGN KEY ("tenant_id", "version_id") REFERENCES "workflow_versions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_tenant_id_approval_group_type_id_fkey" FOREIGN KEY ("tenant_id", "approval_group_type_id") REFERENCES "approval_group_types"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_runtime_states" ADD CONSTRAINT "step_runtime_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_runtime_states" ADD CONSTRAINT "step_runtime_states_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_runtime_states" ADD CONSTRAINT "step_runtime_states_tenant_id_last_assigned_user_id_fkey" FOREIGN KEY ("tenant_id", "last_assigned_user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_candidates" ADD CONSTRAINT "step_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_candidates" ADD CONSTRAINT "step_candidates_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_candidates" ADD CONSTRAINT "step_candidates_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_candidates" ADD CONSTRAINT "step_candidates_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_candidates" ADD CONSTRAINT "step_candidates_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "groups"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "groups"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_initiators" ADD CONSTRAINT "step_initiators_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_sla_overrides" ADD CONSTRAINT "step_sla_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_sla_overrides" ADD CONSTRAINT "step_sla_overrides_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_sla_overrides" ADD CONSTRAINT "step_sla_overrides_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_signers" ADD CONSTRAINT "step_signers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_signers" ADD CONSTRAINT "step_signers_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_signers" ADD CONSTRAINT "step_signers_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_signers" ADD CONSTRAINT "step_signers_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_files" ADD CONSTRAINT "step_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_files" ADD CONSTRAINT "step_files_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_files" ADD CONSTRAINT "step_files_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "stored_files"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_tenant_id_version_id_fkey" FOREIGN KEY ("tenant_id", "version_id") REFERENCES "workflow_versions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_tenant_id_version_id_from_step_id_fkey" FOREIGN KEY ("tenant_id", "version_id", "from_step_id") REFERENCES "steps"("tenant_id", "version_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_tenant_id_version_id_to_step_id_fkey" FOREIGN KEY ("tenant_id", "version_id", "to_step_id") REFERENCES "steps"("tenant_id", "version_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_tenant_id_version_id_fkey" FOREIGN KEY ("tenant_id", "version_id") REFERENCES "workflow_versions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fields" ADD CONSTRAINT "fields_tenant_id_version_id_step_id_fkey" FOREIGN KEY ("tenant_id", "version_id", "step_id") REFERENCES "steps"("tenant_id", "version_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amount_rules" ADD CONSTRAINT "amount_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amount_rules" ADD CONSTRAINT "amount_rules_tenant_id_version_id_fkey" FOREIGN KEY ("tenant_id", "version_id") REFERENCES "workflow_versions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amount_rules" ADD CONSTRAINT "amount_rules_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amount_rules" ADD CONSTRAINT "amount_rules_tenant_id_approval_step_id_fkey" FOREIGN KEY ("tenant_id", "approval_step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amount_rules" ADD CONSTRAINT "amount_rules_tenant_id_position_id_fkey" FOREIGN KEY ("tenant_id", "position_id") REFERENCES "positions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amount_rules" ADD CONSTRAINT "amount_rules_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amount_rules" ADD CONSTRAINT "amount_rules_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_cutoffs" ADD CONSTRAINT "company_cutoffs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_cutoffs" ADD CONSTRAINT "company_cutoffs_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_cutoffs" ADD CONSTRAINT "company_cutoffs_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_tenant_id_dataset_id_fkey" FOREIGN KEY ("tenant_id", "dataset_id") REFERENCES "datasets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculator_configs" ADD CONSTRAINT "calculator_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_subcategory_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "subcategory_id", "workflow_id") REFERENCES "workflows"("tenant_id", "subcategory_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_workflow_id_workflow_version_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id", "workflow_version_id") REFERENCES "workflow_versions"("tenant_id", "workflow_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_subcategory_id_fkey" FOREIGN KEY ("tenant_id", "subcategory_id") REFERENCES "subcategories"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_creator_id_company_id_fkey" FOREIGN KEY ("tenant_id", "creator_id", "company_id") REFERENCES "membership_companies"("tenant_id", "user_id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_priority_id_fkey" FOREIGN KEY ("tenant_id", "priority_id") REFERENCES "priorities"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_creator_id_fkey" FOREIGN KEY ("tenant_id", "creator_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_registered_by_id_fkey" FOREIGN KEY ("tenant_id", "registered_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_closed_by_id_fkey" FOREIGN KEY ("tenant_id", "closed_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_workflow_version_id_current_step_id_fkey" FOREIGN KEY ("tenant_id", "workflow_version_id", "current_step_id") REFERENCES "steps"("tenant_id", "version_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_tenant_id_transition_id_fkey" FOREIGN KEY ("tenant_id", "transition_id") REFERENCES "transitions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_tenant_id_actor_id_fkey" FOREIGN KEY ("tenant_id", "actor_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_tenant_id_assignee_id_fkey" FOREIGN KEY ("tenant_id", "assignee_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_step_visits" ADD CONSTRAINT "ticket_step_visits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_step_visits" ADD CONSTRAINT "ticket_step_visits_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_step_visits" ADD CONSTRAINT "ticket_step_visits_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_step_visits" ADD CONSTRAINT "ticket_step_visits_tenant_id_exit_transition_id_fkey" FOREIGN KEY ("tenant_id", "exit_transition_id") REFERENCES "transitions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_step_visits" ADD CONSTRAINT "ticket_step_visits_tenant_id_calendar_id_fkey" FOREIGN KEY ("tenant_id", "calendar_id") REFERENCES "calendars"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_tenant_id_visit_id_fkey" FOREIGN KEY ("tenant_id", "visit_id") REFERENCES "ticket_step_visits"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sla_clocks" ADD CONSTRAINT "ticket_sla_clocks_tenant_id_responsible_id_fkey" FOREIGN KEY ("tenant_id", "responsible_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_tenant_id_ticket_id_workflow_version_i_fkey" FOREIGN KEY ("tenant_id", "ticket_id", "workflow_version_id") REFERENCES "tickets"("tenant_id", "id", "workflow_version_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_tenant_id_workflow_version_id_field_id_fkey" FOREIGN KEY ("tenant_id", "workflow_version_id", "field_id") REFERENCES "fields"("tenant_id", "version_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_tenant_id_updated_by_id_fkey" FOREIGN KEY ("tenant_id", "updated_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_parallel_tasks" ADD CONSTRAINT "ticket_parallel_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_parallel_tasks" ADD CONSTRAINT "ticket_parallel_tasks_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_parallel_tasks" ADD CONSTRAINT "ticket_parallel_tasks_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_parallel_tasks" ADD CONSTRAINT "ticket_parallel_tasks_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_incidents" ADD CONSTRAINT "ticket_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_incidents" ADD CONSTRAINT "ticket_incidents_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_incidents" ADD CONSTRAINT "ticket_incidents_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_incidents" ADD CONSTRAINT "ticket_incidents_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_incidents" ADD CONSTRAINT "ticket_incidents_tenant_id_assigned_to_id_fkey" FOREIGN KEY ("tenant_id", "assigned_to_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_types" ADD CONSTRAINT "error_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_subtypes" ADD CONSTRAINT "error_subtypes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_subtypes" ADD CONSTRAINT "error_subtypes_tenant_id_error_type_id_fkey" FOREIGN KEY ("tenant_id", "error_type_id") REFERENCES "error_types"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_errors" ADD CONSTRAINT "ticket_errors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_errors" ADD CONSTRAINT "ticket_errors_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_errors" ADD CONSTRAINT "ticket_errors_tenant_id_error_type_id_fkey" FOREIGN KEY ("tenant_id", "error_type_id") REFERENCES "error_types"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_errors" ADD CONSTRAINT "ticket_errors_tenant_id_error_subtype_id_fkey" FOREIGN KEY ("tenant_id", "error_subtype_id") REFERENCES "error_subtypes"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_errors" ADD CONSTRAINT "ticket_errors_tenant_id_reporter_id_fkey" FOREIGN KEY ("tenant_id", "reporter_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_errors" ADD CONSTRAINT "ticket_errors_tenant_id_responsible_id_fkey" FOREIGN KEY ("tenant_id", "responsible_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_owner_id_fkey" FOREIGN KEY ("tenant_id", "owner_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_tenant_id_tag_id_user_id_fkey" FOREIGN KEY ("tenant_id", "tag_id", "user_id") REFERENCES "tags"("tenant_id", "id", "owner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_signatures" ADD CONSTRAINT "ticket_signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_signatures" ADD CONSTRAINT "ticket_signatures_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_signatures" ADD CONSTRAINT "ticket_signatures_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_signatures" ADD CONSTRAINT "ticket_signatures_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_signatures" ADD CONSTRAINT "ticket_signatures_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "stored_files"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_uploaded_by_id_fkey" FOREIGN KEY ("tenant_id", "uploaded_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_documents" ADD CONSTRAINT "ticket_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_documents" ADD CONSTRAINT "ticket_documents_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_documents" ADD CONSTRAINT "ticket_documents_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "stored_files"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_documents" ADD CONSTRAINT "ticket_documents_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "ticket_events"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_documents" ADD CONSTRAINT "ticket_documents_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "steps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_formats" ADD CONSTRAINT "pdf_formats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_formats" ADD CONSTRAINT "pdf_formats_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_formats" ADD CONSTRAINT "pdf_formats_tenant_id_updated_by_id_fkey" FOREIGN KEY ("tenant_id", "updated_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_templates" ADD CONSTRAINT "pdf_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_templates" ADD CONSTRAINT "pdf_templates_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_templates" ADD CONSTRAINT "pdf_templates_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_templates" ADD CONSTRAINT "pdf_templates_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "stored_files"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_template_fields" ADD CONSTRAINT "pdf_template_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_template_fields" ADD CONSTRAINT "pdf_template_fields_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "pdf_templates"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_template_signatures" ADD CONSTRAINT "pdf_template_signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_template_signatures" ADD CONSTRAINT "pdf_template_signatures_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "pdf_templates"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_documents" ADD CONSTRAINT "workflow_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_documents" ADD CONSTRAINT "workflow_documents_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_documents" ADD CONSTRAINT "workflow_documents_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_documents" ADD CONSTRAINT "workflow_documents_tenant_id_format_id_fkey" FOREIGN KEY ("tenant_id", "format_id") REFERENCES "pdf_formats"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_documents" ADD CONSTRAINT "workflow_documents_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "pdf_templates"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_definitions" ADD CONSTRAINT "export_definitions_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_columns" ADD CONSTRAINT "export_columns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_columns" ADD CONSTRAINT "export_columns_tenant_id_definition_id_fkey" FOREIGN KEY ("tenant_id", "definition_id") REFERENCES "export_definitions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_catalog_entries" ADD CONSTRAINT "export_catalog_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_cutoffs" ADD CONSTRAINT "export_cutoffs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_cutoffs" ADD CONSTRAINT "export_cutoffs_tenant_id_definition_id_fkey" FOREIGN KEY ("tenant_id", "definition_id") REFERENCES "export_definitions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_cutoffs" ADD CONSTRAINT "export_cutoffs_tenant_id_generated_by_id_fkey" FOREIGN KEY ("tenant_id", "generated_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_cutoffs" ADD CONSTRAINT "export_cutoffs_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "stored_files"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_lines" ADD CONSTRAINT "export_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_lines" ADD CONSTRAINT "export_lines_tenant_id_definition_id_fkey" FOREIGN KEY ("tenant_id", "definition_id") REFERENCES "export_definitions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_lines" ADD CONSTRAINT "export_lines_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_lines" ADD CONSTRAINT "export_lines_tenant_id_confirmed_by_id_fkey" FOREIGN KEY ("tenant_id", "confirmed_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_lines" ADD CONSTRAINT "export_lines_tenant_id_cutoff_id_fkey" FOREIGN KEY ("tenant_id", "cutoff_id") REFERENCES "export_cutoffs"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_webhook_id_fkey" FOREIGN KEY ("tenant_id", "webhook_id") REFERENCES "webhooks"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_actor_id_fkey" FOREIGN KEY ("tenant_id", "actor_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_templates" ADD CONSTRAINT "text_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_templates" ADD CONSTRAINT "text_templates_tenant_id_owner_id_fkey" FOREIGN KEY ("tenant_id", "owner_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_template_shares" ADD CONSTRAINT "text_template_shares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_template_shares" ADD CONSTRAINT "text_template_shares_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "text_templates"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_template_shares" ADD CONSTRAINT "text_template_shares_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

