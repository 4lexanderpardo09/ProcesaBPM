/**
 * What the organization data export contains: an explicit allow-list of datasets and of the columns each one reads
 * (never `SELECT *`), grouped as in docs/arquitectura.md §20. Every table with `tenant_id` is either exported here or
 * excluded with a reason, column by column for the exported ones: `data-export-coverage.test.ts` compares this file
 * with the database and fails when a new table or column is not classified. Secrets (hashes, tokens, backup codes,
 * MFA secrets, webhook secrets) are never exported, not even encrypted.
 */

export const EXPORT_GROUPS = ['organization', 'identity', 'catalog', 'workflows', 'tickets', 'trail'] as const;
export type ExportGroup = (typeof EXPORT_GROUPS)[number];

export interface ExportDataset<N extends string = string> {
  /** `data/<name>.jsonl` (and `csv/<name>.csv` when `csv`). */
  readonly name: N;
  readonly group: ExportGroup;
  /** The database columns the dataset reads, by table. */
  readonly sources: Readonly<Record<string, readonly string[]>>;
  /** The output columns, in order: the keys of every JSON line and the CSV header. */
  readonly columns: readonly string[];
  /** Output columns that order the rows and page through them (the primary key without `tenant_id`). */
  readonly key: readonly string[];
  /** Also written as CSV for people (decision B15). */
  readonly csv: boolean;
  /** Columns of type date or time: the driver returns them as instants, the export writes `yyyy-mm-dd` or `hh:mm:ss`. */
  readonly formats?: Readonly<Record<string, ColumnFormat>>;
}

export type ColumnFormat = 'date' | 'time';

/** Keeps the dataset's name as a literal type while its lists stay plain string lists. */
function dataset<N extends string>(spec: ExportDataset<N>): ExportDataset<N> {
  return spec;
}

/** A dataset that is one table, read column for column. */
function table<N extends string>(name: N, group: ExportGroup, columns: readonly string[], key: readonly string[], options: { csv?: boolean; formats?: Record<string, ColumnFormat> } = {}): ExportDataset<N> {
  return { name, group, sources: { [name]: columns }, columns, key, csv: options.csv ?? false, ...(options.formats === undefined ? {} : { formats: options.formats }) };
}

export const EXPORT_DATASETS = [
  dataset({
    name: 'tenants',
    group: 'organization',
    sources: { tenants: ['id', 'slug', 'name', 'status', 'country_code', 'time_zone', 'primary_color', 'logo_file_id', 'mfa_required', 'cancelled_at', 'deletion_requested_at', 'purge_after', 'created_at', 'updated_at'] },
    columns: ['id', 'slug', 'name', 'status', 'country_code', 'time_zone', 'primary_color', 'logo_file_id', 'mfa_required', 'cancelled_at', 'deletion_requested_at', 'purge_after', 'created_at', 'updated_at'],
    key: ['id'],
    csv: false,
  }),
  table('companies', 'organization', ['tenant_id', 'id', 'name', 'tax_id', 'is_default', 'country_code', 'currency_code', 'time_zone', 'calendar_id', 'is_active', 'created_at'], ['id']),
  table('departments', 'organization', ['tenant_id', 'id', 'name', 'is_active', 'created_at'], ['id']),
  table('positions', 'organization', ['tenant_id', 'id', 'name', 'is_active', 'created_at'], ['id']),
  table('site_levels', 'organization', ['tenant_id', 'level', 'name'], ['level']),
  table('sites', 'organization', ['tenant_id', 'id', 'parent_id', 'level', 'name', 'is_central', 'is_active', 'created_at'], ['id']),
  table('calendars', 'organization', ['tenant_id', 'id', 'name', 'country_code', 'is_default', 'created_at'], ['id']),
  table('calendar_working_hours', 'organization', ['tenant_id', 'id', 'calendar_id', 'weekday', 'start_time', 'end_time'], ['id'], { formats: { start_time: 'time', end_time: 'time' } }),
  table('calendar_holidays', 'organization', ['tenant_id', 'calendar_id', 'date', 'name'], ['calendar_id', 'date'], { formats: { date: 'date' } }),
  dataset({
    name: 'members',
    group: 'identity',
    sources: {
      memberships: ['tenant_id', 'user_id', 'role_id', 'position_id', 'department_id', 'site_id', 'status', 'is_owner', 'signature_file_id', 'joined_at', 'created_at', 'updated_at'],
      users: ['email', 'first_name', 'last_name', 'document_number', 'status', 'locale', 'time_zone'],
    },
    columns: ['tenant_id', 'user_id', 'email', 'first_name', 'last_name', 'document_number', 'account_status', 'locale', 'time_zone', 'role_id', 'position_id', 'department_id', 'site_id', 'status', 'is_owner', 'signature_file_id', 'joined_at', 'created_at', 'updated_at'],
    key: ['user_id'],
    csv: true,
  }),
  table('membership_companies', 'identity', ['tenant_id', 'user_id', 'company_id'], ['user_id', 'company_id']),
  table('roles', 'identity', ['tenant_id', 'id', 'name', 'description', 'system_role', 'is_admin', 'is_active', 'created_at', 'permissions_version'], ['id']),
  dataset({
    name: 'role_permissions',
    group: 'identity',
    sources: { role_permissions: ['tenant_id', 'role_id', 'permission_id', 'conditions'], permissions: ['action', 'subject'] },
    columns: ['tenant_id', 'role_id', 'permission_id', 'action', 'subject', 'conditions'],
    key: ['role_id', 'permission_id'],
    csv: false,
  }),
  table('groups', 'identity', ['tenant_id', 'id', 'name', 'is_active', 'created_at'], ['id']),
  table('group_members', 'identity', ['tenant_id', 'group_id', 'user_id'], ['group_id', 'user_id']),
  table('approval_group_types', 'identity', ['tenant_id', 'id', 'name', 'is_default', 'created_at'], ['id']),
  table('approval_groups', 'identity', ['tenant_id', 'id', 'type_id', 'company_id', 'name', 'is_active', 'created_at'], ['id']),
  table('approval_group_approvers', 'identity', ['tenant_id', 'group_id', 'user_id', 'position'], ['group_id', 'user_id']),
  table('approval_group_members', 'identity', ['tenant_id', 'group_id', 'type_id', 'company_id', 'user_id'], ['group_id', 'user_id']),
  table('delegations', 'identity', ['tenant_id', 'id', 'from_user_id', 'to_user_id', 'starts_at', 'ends_at', 'reason', 'created_at'], ['id']),
  table('priorities', 'catalog', ['tenant_id', 'id', 'name', 'sort_order', 'color', 'is_active'], ['id']),
  table('categories', 'catalog', ['tenant_id', 'id', 'name', 'is_active', 'created_at'], ['id']),
  table('category_companies', 'catalog', ['tenant_id', 'category_id', 'company_id'], ['category_id', 'company_id']),
  table('category_departments', 'catalog', ['tenant_id', 'category_id', 'department_id'], ['category_id', 'department_id']),
  table('subcategories', 'catalog', ['tenant_id', 'id', 'category_id', 'default_priority_id', 'name', 'description', 'is_active', 'created_at'], ['id']),
  table('error_types', 'catalog', ['tenant_id', 'id', 'name', 'description', 'is_process_error', 'forces_close', 'is_reopening', 'is_active'], ['id']),
  table('error_subtypes', 'catalog', ['tenant_id', 'id', 'error_type_id', 'name', 'description', 'is_active'], ['id']),
  table('tags', 'catalog', ['tenant_id', 'id', 'owner_id', 'name', 'color'], ['id']),
  table('calculator_configs', 'catalog', ['tenant_id', 'code', 'config', 'updated_at'], ['code']),
  table('workflows', 'workflows', ['tenant_id', 'id', 'subcategory_id', 'name', 'is_active', 'created_at'], ['id']),
  table('workflow_observers', 'workflows', ['tenant_id', 'id', 'workflow_id', 'participant_type', 'user_id', 'position_id', 'group_id'], ['id']),
  table('workflow_versions', 'workflows', ['tenant_id', 'id', 'workflow_id', 'number', 'status', 'notes', 'published_at', 'published_by_id', 'created_at', 'revision'], ['id']),
  table('steps', 'workflows', ['tenant_id', 'id', 'version_id', 'type', 'name', 'description', 'assignment_mode', 'manual_selection', 'site_scope', 'position_id', 'approval_group_type_id', 'approval_level', 'close_rule', 'sla_value', 'sla_unit', 'deadline_type', 'deadline_field_code', 'deadline_business_days', 'max_loops', 'dispatch_interval_min', 'allows_batch', 'config', 'ui_x', 'ui_y'], ['id']),
  table('step_candidates', 'workflows', ['tenant_id', 'id', 'step_id', 'participant_type', 'user_id', 'position_id', 'group_id'], ['id']),
  table('step_initiators', 'workflows', ['tenant_id', 'id', 'step_id', 'participant_type', 'user_id', 'position_id', 'group_id', 'department_id', 'company_id', 'site_id'], ['id']),
  table('step_sla_overrides', 'workflows', ['tenant_id', 'step_id', 'company_id', 'sla_value', 'sla_unit'], ['step_id', 'company_id']),
  table('step_signers', 'workflows', ['tenant_id', 'id', 'step_id', 'signer_type', 'user_id', 'position_id', 'label', 'sort_order'], ['id']),
  table('step_files', 'workflows', ['tenant_id', 'step_id', 'file_id', 'label', 'sort_order'], ['step_id', 'file_id']),
  table('transitions', 'workflows', ['tenant_id', 'id', 'version_id', 'from_step_id', 'to_step_id', 'type', 'label', 'condition', 'sort_order', 'ui_points'], ['id']),
  table('fields', 'workflows', ['tenant_id', 'id', 'version_id', 'step_id', 'code', 'label', 'type', 'capture', 'is_required', 'is_read_only', 'sort_order', 'config', 'data_source'], ['id']),
  table('amount_rules', 'workflows', ['tenant_id', 'id', 'version_id', 'step_id', 'position_id', 'company_id', 'field_code', 'row_type_value', 'amount_column', 'type_column', 'max_amount', 'currency_code', 'action', 'approval_step_id', 'message', 'is_active'], ['id']),
  table('company_cutoffs', 'workflows', ['tenant_id', 'id', 'workflow_id', 'company_id', 'cutoff_day', 'grace_business_days', 'description', 'is_active'], ['id']),
  table('datasets', 'workflows', ['tenant_id', 'id', 'workflow_id', 'name', 'columns', 'source_file_name', 'loaded_at', 'is_active'], ['id']),
  table('dataset_rows', 'workflows', ['tenant_id', 'id', 'dataset_id', 'lookup_key', 'data'], ['id']),
  table('pdf_formats', 'workflows', ['tenant_id', 'id', 'workflow_id', 'name', 'description', 'design', 'file_name_pattern', 'updated_by_id', 'is_active', 'created_at', 'updated_at'], ['id']),
  table('pdf_templates', 'workflows', ['tenant_id', 'id', 'workflow_id', 'company_id', 'file_id', 'name', 'pages', 'has_acroform', 'is_active', 'created_at', 'acroform_fields', 'updated_at'], ['id']),
  table('pdf_template_fields', 'workflows', ['tenant_id', 'id', 'template_id', 'mode', 'field_code', 'expression', 'acroform_name', 'page', 'x', 'y', 'font_size', 'max_width', 'align'], ['id']),
  table('pdf_template_signatures', 'workflows', ['tenant_id', 'id', 'template_id', 'mode', 'step_name', 'signer_type', 'signer_label', 'acroform_name', 'page', 'x', 'y', 'width', 'height'], ['id']),
  table('workflow_documents', 'workflows', ['tenant_id', 'id', 'workflow_id', 'company_id', 'kind', 'format_id', 'template_id', 'moment', 'is_active'], ['id']),
  table('text_templates', 'workflows', ['tenant_id', 'id', 'owner_id', 'title', 'body_html', 'created_at', 'updated_at'], ['id']),
  table('text_template_shares', 'workflows', ['tenant_id', 'template_id', 'user_id'], ['template_id', 'user_id']),
  table('tickets', 'tickets', ['tenant_id', 'id', 'number', 'workflow_id', 'workflow_version_id', 'subcategory_id', 'priority_id', 'company_id', 'department_id', 'site_id', 'creator_id', 'registered_by_id', 'title', 'description_html', 'status', 'current_step_id', 'current_loop', 'closed_at', 'closed_by_id', 'forced_close', 'created_at', 'updated_at', 'deleted_at'], ['id'], { csv: true }),
  table('ticket_assignees', 'tickets', ['tenant_id', 'ticket_id', 'user_id', 'type', 'assigned_at'], ['ticket_id', 'user_id']),
  table('ticket_field_values', 'tickets', ['tenant_id', 'ticket_id', 'workflow_version_id', 'field_id', 'value', 'updated_by_id', 'updated_at'], ['ticket_id', 'field_id'], { csv: true }),
  table('ticket_events', 'tickets', ['tenant_id', 'id', 'ticket_id', 'type', 'step_id', 'transition_id', 'loop', 'actor_id', 'assignee_id', 'comment_html', 'data', 'created_at', 'seq'], ['id'], { csv: true }),
  table('ticket_step_visits', 'tickets', ['tenant_id', 'id', 'ticket_id', 'step_id', 'loop', 'entered_at', 'exited_at', 'exit_transition_id', 'sla_value', 'sla_unit', 'calendar_id', 'due_at', 'paused_minutes', 'business_minutes', 'result', 'resume_at', 'resume_enqueued_at'], ['id']),
  table('ticket_sla_clocks', 'tickets', ['tenant_id', 'id', 'ticket_id', 'visit_id', 'step_id', 'loop', 'company_id', 'responsible_id', 'sla_value', 'sla_unit', 'calendar_id', 'started_at', 'due_at', 'paused_at', 'paused_minutes', 'completed_at', 'business_minutes', 'result', 'alerted_at', 'warned_at', 'completion_reason'], ['id']),
  table('ticket_parallel_tasks', 'tickets', ['tenant_id', 'id', 'ticket_id', 'step_id', 'loop', 'user_id', 'status', 'comment', 'completed_at', 'created_at'], ['id']),
  table('ticket_incidents', 'tickets', ['tenant_id', 'id', 'ticket_id', 'step_id', 'created_by_id', 'assigned_to_id', 'description', 'resolution', 'status', 'previous_assignee_ids', 'opened_at', 'resolved_at'], ['id']),
  table('ticket_errors', 'tickets', ['tenant_id', 'id', 'ticket_id', 'error_type_id', 'error_subtype_id', 'reporter_id', 'responsible_id', 'description', 'is_process_error', 'created_at'], ['id']),
  table('ticket_tags', 'tickets', ['tenant_id', 'ticket_id', 'tag_id', 'user_id', 'created_at'], ['ticket_id', 'tag_id']),
  table('ticket_signatures', 'tickets', ['tenant_id', 'id', 'ticket_id', 'step_id', 'loop', 'user_id', 'file_id', 'is_parallel', 'signed_at'], ['id']),
  table('ticket_documents', 'tickets', ['tenant_id', 'id', 'ticket_id', 'file_id', 'role', 'event_id', 'step_id', 'field_code', 'version', 'is_current', 'created_at', 'deleted_at'], ['id']),
  table('stored_files', 'tickets', ['tenant_id', 'id', 'company_id', 'original_name', 'mime_type', 'size_bytes', 'sha256', 'origin', 'status', 'uploaded_by_id', 'created_at', 'confirmed_at', 'deleted_at', 'linked_at'], ['id']),
  table('audit_logs', 'trail', ['tenant_id', 'id', 'actor_id', 'action', 'entity_type', 'entity_id', 'before', 'after', 'ip_address', 'created_at', 'user_agent', 'request_id', 'support_actor_id', 'support_grant_id'], ['id'], { csv: true }),
  table('support_access_grants', 'trail', ['tenant_id', 'id', 'granted_by_id', 'reason', 'starts_at', 'expires_at', 'revoked_at', 'revoked_by_id', 'created_at'], ['id']),
  table('support_sessions', 'trail', ['tenant_id', 'id', 'grant_id', 'platform_user_id', 'platform_user_label', 'opened_at', 'closed_at'], ['id']),
] as const;

export type ExportDatasetName = (typeof EXPORT_DATASETS)[number]['name'];

/** Tables with `tenant_id` that are not exported, and why. */
export const EXPORT_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  outbox_events: 'Internal work queue of the worker.',
  notifications: 'Copies of what tickets and events already contain, per recipient.',
  notification_preferences: 'Personal settings of each member, not organization data.',
  webhooks: 'Holds the signing secret of each webhook (never exported, not even encrypted).',
  webhook_deliveries: 'Delivery log of the webhooks (payload copies and remote responses).',
  tenant_sequences: 'Internal counters (ticket numbers are in tickets).',
  tenant_usage: 'Storage accounting of the plan.',
  tenant_settings: 'Free-form key/value settings that could hold integration credentials; unused by the application today.',
  step_runtime_states: 'Dispatcher bookkeeping (round robin position).',
  export_definitions: 'Scheduled flat-file exports: version 2.',
  export_columns: 'Scheduled flat-file exports: version 2.',
  export_catalog_entries: 'Scheduled flat-file exports: version 2.',
  export_cutoffs: 'Scheduled flat-file exports: version 2.',
  export_lines: 'Scheduled flat-file exports: version 2.',
  tenant_data_exports: 'The export requests themselves (job state, storage keys).',
  platform_announcement_tenants: 'Audience of platform announcements: platform data.',
};

/** Columns of the exported tables (and of the global tables they join) that are left out, and why. */
export const EXPORT_EXCLUDED_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  tenants: {
    plan_id: 'Platform billing.',
    extra_storage_bytes: 'Platform billing.',
    db_cluster: 'Infrastructure placement.',
    deletion_requested_by_id: 'A platform administrator, not a member.',
    purge_attempts: 'Purge job internals.',
    purge_last_error: 'Purge job internals.',
    purge_lease_until: 'Purge job internals.',
    purge_retry_at: 'Purge job internals.',
    purge_reminder_level: 'Purge job internals (which reminder went out to the owner).',
    purged_at: 'Purge job internals.',
  },
  users: {
    id: 'Join key only: exported as members.user_id (from memberships).',
    password_hash: 'Secret.',
    mfa_secret_encrypted: 'Secret.',
    mfa_enabled: 'Account security state, not organization data.',
    mfa_enabled_at: 'Account security state.',
    mfa_last_step: 'Account security state.',
    mfa_failed_attempts: 'Account security state.',
    mfa_locked_until: 'Account security state.',
    mfa_reset_at: 'Account security state.',
    password_changed_at: 'Account security state.',
    failed_logins: 'Account security state.',
    locked_until: 'Account security state.',
    email_verified_at: 'Account state, shared by every organization of the person.',
    last_login_at: 'Activity of the account in any organization.',
    created_at: 'Account dates, shared by every organization of the person (the membership dates are exported).',
    updated_at: 'Account dates, shared by every organization of the person.',
  },
  permissions: {
    id: 'Exported as role_permissions.permission_id.',
    description: 'Global catalog text, the same for every organization.',
  },
  tickets: { search_vector: 'Derived full-text index.' },
  stored_files: { storage_key: 'Internal location in the object storage; the bytes are under files/.' },
  support_sessions: { platform_session_id: 'Session of the platform administrator, not organization data.' },
};

/** Column names that suggest a secret: an exported column may not match unless it is allowed below with a reason. */
export const SENSITIVE_COLUMN_NAME = /(password|secret|token|hash|encrypted|mfa_|key|credential|otp|salt|session|signing|private|recovery|nonce)/;

export const SENSITIVE_NAMES_ALLOWED: Readonly<Record<string, string>> = {
  'tenants.mfa_required': 'The organization policy flag (whether members must use a second factor), not a secret.',
  'dataset_rows.lookup_key': 'The business key a ticket field looks a row up by (e.g. an employee code), not a credential.',
};

export const EXPORT_DATASET_BY_NAME: Readonly<Record<ExportDatasetName, ExportDataset<ExportDatasetName>>> = Object.fromEntries(EXPORT_DATASETS.map((dataset) => [dataset.name, dataset])) as Record<ExportDatasetName, ExportDataset<ExportDatasetName>>;

/** The datasets also written as CSV. */
export const CSV_DATASETS: readonly ExportDatasetName[] = EXPORT_DATASETS.filter((dataset) => dataset.csv).map((dataset) => dataset.name);
