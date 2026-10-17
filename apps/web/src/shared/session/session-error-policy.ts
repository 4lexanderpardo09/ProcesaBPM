import { ERROR_CODES } from '@procesabpm/shared';
import { z } from 'zod';
import { ApiError, NetworkError } from '@/shared/api';
import type { RefreshFailure, SessionBlock } from './session-errors';

export type SessionEffect =
  | { readonly kind: 'ended'; readonly reason: 'expired' | 'mfaRequired' }
  | { readonly kind: 'blocked'; readonly block: SessionBlock }
  | { readonly kind: 'deletionPending' };

const maintenanceDetailsSchema = z.object({ title: z.string(), body: z.string().optional(), endsAt: z.string().nullable() });

/** Organization-level states that keep the session but stop the work (403 and 503 keep the refresh cookie). */
export function sessionBlockOf(error: ApiError): SessionBlock | undefined {
  if (error.code === ERROR_CODES.tenantSuspended) return { kind: 'tenantSuspended' };
  if (error.code === ERROR_CODES.tenantPendingDeletion) return { kind: 'tenantPendingDeletion' };
  if (error.code !== ERROR_CODES.maintenance) return undefined;
  const details = maintenanceDetailsSchema.safeParse(error.details);
  return {
    kind: 'maintenance',
    details: details.success ? details.data : { title: '', endsAt: null },
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

/** What an error from an authorized request means for the whole session (`undefined`: nothing, the caller handles it). */
export function sessionEffectOf(error: ApiError): SessionEffect | undefined {
  if (error.status === 401) return { kind: 'ended', reason: 'expired' };
  if (error.code === ERROR_CODES.mfaRequired) return { kind: 'ended', reason: 'mfaRequired' };
  if (error.code === ERROR_CODES.tenantPendingDeletion) return { kind: 'deletionPending' };
  const block = sessionBlockOf(error);
  return block === undefined ? undefined : { kind: 'blocked', block };
}

export function refreshFailureOf(error: unknown): RefreshFailure {
  if (error instanceof NetworkError) return { kind: 'network' };
  if (!(error instanceof ApiError)) return { kind: 'unavailable' };
  if (error.status === 401) return { kind: 'unauthenticated' };
  if (error.code === ERROR_CODES.mfaRequired) return { kind: 'mfaRequired' };
  const block = sessionBlockOf(error);
  return block === undefined ? { kind: 'unavailable' } : { kind: 'blocked', block };
}
