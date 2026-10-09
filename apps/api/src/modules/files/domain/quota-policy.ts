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

export type QuotaWarningLevel = 0 | 80 | 95;

/**
 * The highest warning threshold the stored bytes reached, as a percentage of what the plan includes (the grace margin
 * is beyond it). Reservations do not count: they are uploads in flight, and a failed one would warn for nothing.
 */
export function quotaWarningLevel(limits: QuotaLimits, usedBytes: bigint): QuotaWarningLevel {
  if (usedBytes <= 0n) return 0;
  for (const level of [95, 80] as const) if (usedBytes * 100n >= limits.limitBytes * BigInt(level)) return level;
  return 0;
}
