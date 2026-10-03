/**
 * The retention steps in the order a run takes them: the busy technical tables first, then the trails. The audit rows of
 * a support visit go before the visit, and the visit before its grant (foreign keys). Each step is one database function
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
] as const;

export type RetentionStep = (typeof RETENTION_STEPS)[number];

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
