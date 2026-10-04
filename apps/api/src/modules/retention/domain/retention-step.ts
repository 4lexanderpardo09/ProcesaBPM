/**
 * The retention steps in the order a run takes them: the busy technical tables first, then the trails, then the expired
 * data export archives. The audit rows of a support visit go before the visit, and the visit before its grant (foreign keys). Each step is one database function
 * whose window is fixed in SQL (docs/base-de-datos.md §8.27); the worker only chooses how much to delete per call.
 */
export const RETENTION_STEPS = [
  'outbox_events',
  'platform_outbox_events',
  'notifications',
  'refresh_sessions',
  'user_tokens',
  'audit_logs',
  'support_sessions',
  'support_access_grants',
  'platform_audit_logs',
  'expire_tenant_exports',
] as const;

export type RetentionStep = (typeof RETENTION_STEPS)[number];

/** The step that also deletes objects in the storage (organization data exports past their expiry, §8.31). */
export const EXPORT_EXPIRY_STEP = 'expire_tenant_exports' satisfies RetentionStep;
/** The steps that are one database function each. */
export type TableRetentionStep = Exclude<RetentionStep, typeof EXPORT_EXPIRY_STEP>;

/** An export whose archive the worker deletes after the commit that marked it EXPIRED. */
export interface ExpiredExportObject {
  readonly tenantId: string;
  readonly exportId: string;
  readonly storageKey: string;
}

export interface RetentionRunSummary {
  readonly runId: string;
  readonly deleted: Readonly<Partial<Record<RetentionStep, number>>>;
  readonly failed: readonly RetentionStep[];
  readonly durationMs: number;
  /** A shutdown stopped the run before it went through every step; the rest waits for the next night. */
  readonly interrupted: boolean;
}

/** What `retention_start_run` answered: this replica got tonight's run, or another one started it at `startedAt`. */
export type RetentionRunClaim = { readonly kind: 'started'; readonly runId: string } | { readonly kind: 'skipped'; readonly blockingStartedAt: Date };
