import type { RateLimitPolicy } from '../../../common/auth/rate-limit.js';

/** Failed logins in a row that lock the account, and for how long (docs/base-de-datos.md §6.4). */
export const LOGIN_LOCKOUT = { maxFailedAttempts: 5, lockMinutes: 15 } as const;

/** Absolute lifetime of a session from the tenant selection; rotations keep the same expiry. */
export const REFRESH_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A rotated refresh token presented again within this window is a benign race (two tabs refreshing
 * at once): it is refused without revoking anything. Later, it is treated as a stolen copy.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export const PASSWORD_RESET_EMAIL_EVENT = 'email.password_reset';

const MINUTE = 60_000;

export const RATE_LIMITS = {
  login: { name: 'login', perIp: { limit: 30, windowMs: 15 * MINUTE }, perIdentifier: { limit: 10, windowMs: 15 * MINUTE } },
  passwordReset: {
    name: 'password-reset',
    perIp: { limit: 10, windowMs: 15 * MINUTE },
    perIdentifier: { limit: 3, windowMs: 15 * MINUTE },
  },
  passwordResetConfirm: {
    name: 'password-reset-confirm',
    perIp: { limit: 20, windowMs: 15 * MINUTE },
    perIdentifier: { limit: 5, windowMs: 15 * MINUTE },
  },
  invitation: { name: 'invitation', perIp: { limit: 20, windowMs: 15 * MINUTE }, perIdentifier: { limit: 5, windowMs: 15 * MINUTE } },
} as const satisfies Record<string, RateLimitPolicy>;
