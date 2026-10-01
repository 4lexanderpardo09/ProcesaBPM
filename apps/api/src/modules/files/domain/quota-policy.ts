import type { StorageState } from '@procesabpm/shared';

export interface QuotaTerms {
  readonly baseBytes: bigint;
  readonly perUserBytes: bigint;
  readonly gracePercent: number;
  readonly extraBytes: bigint;
  readonly activeUsers: number;
}

export interface QuotaUsage {
  readonly usedBytes: bigint;
  readonly reservedBytes: bigint;
}

export interface QuotaLimits {
  /** What the plan includes: going over it is allowed, but warned about. */
  readonly limitBytes: bigint;
  /** Limit plus the grace margin: nothing is accepted beyond it. */
  readonly hardLimitBytes: bigint;
}

export function quotaLimits(terms: QuotaTerms): QuotaLimits {
  const limitBytes = terms.baseBytes + terms.perUserBytes * BigInt(terms.activeUsers) + terms.extraBytes;
  return { limitBytes, hardLimitBytes: limitBytes + (limitBytes * BigInt(terms.gracePercent)) / 100n };
}

export type QuotaDecision = { readonly allowed: false } | { readonly allowed: true; readonly overLimit: boolean };

/** Used, reserved (uploads in flight) and the new request all count against the limits. */
export function evaluateReservation(limits: QuotaLimits, usage: QuotaUsage, requestedBytes: bigint): QuotaDecision {
  const total = usage.usedBytes + usage.reservedBytes + requestedBytes;
  return total > limits.hardLimitBytes ? { allowed: false } : { allowed: true, overLimit: total > limits.limitBytes };
}

export function storageState(limits: QuotaLimits, usage: QuotaUsage): StorageState {
  const total = usage.usedBytes + usage.reservedBytes;
  if (total >= limits.hardLimitBytes) return 'BLOCKED';
  return total > limits.limitBytes ? 'OVER_LIMIT' : 'OK';
}
