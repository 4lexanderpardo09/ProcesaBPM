import { ExportExpiredError, ExportInProgressError, ExportLimitReachedError, ExportNotReadyError, ExportTooLateError, InvalidStateError, NotFoundError, PermissionDeniedError, type DataExportStatus } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import type { RateLimitRule } from '../../../infrastructure/security/rate-limiter.js';
import { hasFullAccess } from '../../authorization/domain/full-access.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** docs/arquitectura.md §19 and the business decisions B11–B13 (docs/pendientes.md). */
export const DATA_EXPORT_POLICY = {
  /** Requests per organization during the deletion period. */
  maxRequestsPerTenant: 5,
  /** Below this, the export could not be built and downloaded before the purge. */
  minTimeBeforePurgeMs: 6 * HOUR_MS,
  /** Each download link works for a few minutes: issuing it is the access (it is counted and audited). */
  downloadUrlTtlSeconds: 5 * 60,
  downloadUrlsPerUser: { limit: 10, windowMs: HOUR_MS },
  /** The password check counts against the account lockout too; this only stops floods. */
  requestsPerUser: { limit: 5, windowMs: 15 * MINUTE_MS },
} as const satisfies Record<string, number | RateLimitRule>;

/**
 * Only the owner or a member of an active admin role, signed in to an organization that is pending deletion, may export
 * it. Never a support visit (read-only, and not a member) nor a member whose role was narrowed: the check is the fixed
 * full-access rule, not a permission of the catalog, so no custom role can ever be given it.
 */
export function assertMayExport(principal: Principal): void {
  if (principal.support !== undefined || !hasFullAccess(principal)) throw new PermissionDeniedError('Only the owner or an administrator can export the organization');
  if (principal.tenantMode !== 'DELETION_PENDING') throw new InvalidStateError('The data export is available during the deletion period only');
}

export interface RequestContextFacts {
  readonly tenantStatus: string;
  readonly purgeAfter: Date | null;
  readonly requests: number;
  readonly inFlight: number;
  readonly now: Date;
}

/** The checks a new request must pass, in the order the person can act on them. */
export function assertMayRequest(facts: RequestContextFacts): void {
  if (facts.tenantStatus !== 'PENDING_DELETION' || facts.purgeAfter === null) throw new InvalidStateError('The data export is available during the deletion period only');
  if (facts.purgeAfter.getTime() - facts.now.getTime() < DATA_EXPORT_POLICY.minTimeBeforePurgeMs) throw new ExportTooLateError();
  if (facts.inFlight > 0) throw new ExportInProgressError();
  if (facts.requests >= DATA_EXPORT_POLICY.maxRequestsPerTenant) throw new ExportLimitReachedError(DATA_EXPORT_POLICY.maxRequestsPerTenant);
}

/** Why a download link cannot be issued for an export that is not READY and in date. */
export function downloadRefusalFor(state: { readonly status: DataExportStatus } | undefined): Error {
  if (state === undefined) return new NotFoundError();
  if (state.status === 'READY' || state.status === 'EXPIRED') return new ExportExpiredError();
  return new ExportNotReadyError();
}

/** Short-lived, and never valid beyond the export itself (which never outlives the purge). */
export function downloadUrlTtlSeconds(expiresAt: Date, now: Date): number {
  const left = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return Math.max(1, Math.min(DATA_EXPORT_POLICY.downloadUrlTtlSeconds, left));
}

/** `<slug>-export-<yyyy-mm-dd>.zip`, dated by when the archive was built (UTC). */
export function exportFileName(slug: string, completedAt: Date): string {
  return `${slug}-export-${completedAt.toISOString().slice(0, 10)}.zip`;
}
