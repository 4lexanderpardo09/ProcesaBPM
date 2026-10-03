import { z } from 'zod';
import { uuidSchema } from '../ids.js';

export const SUPPORT_ACCESS_DEFAULT_HOURS = 24;
export const SUPPORT_ACCESS_MAX_HOURS = 72;

export const grantSupportAccessRequestSchema = z.object({
  hours: z.number().int().min(1).max(SUPPORT_ACCESS_MAX_HOURS).default(SUPPORT_ACCESS_DEFAULT_HOURS),
  reason: z.string().trim().min(3).max(500),
});
export type GrantSupportAccessRequest = z.infer<typeof grantSupportAccessRequestSchema>;

export interface SupportVisitResponse {
  readonly id: string;
  /** First and last name of the platform administrator, as they were when the visit opened. */
  readonly administrator: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export interface SupportGrantResponse {
  readonly id: string;
  readonly status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  readonly reason: string;
  readonly grantedBy: { readonly userId: string; readonly name: string };
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: { readonly userId: string; readonly name: string } | null;
  readonly visits: readonly SupportVisitResponse[];
  /** How many requests support made under the grant (each one is in the audit log). */
  readonly requests: number;
}

export interface SupportAccessResponse {
  /** The grant in force, if any. */
  readonly active: SupportGrantResponse | null;
  /** The latest grants, newest first (the active one included). */
  readonly history: readonly SupportGrantResponse[];
}

/** Claims of a support token: a platform administrator reading one tenant, read-only. */
export const supportTokenClaimsSchema = z.object({
  /** The platform administrator (a user, not a member of the tenant). */
  sub: uuidSchema,
  tid: uuidSchema,
  /** The support session (row of `support_sessions`). */
  sid: uuidSchema,
  /** The grant it was opened under. */
  grant: uuidSchema,
});
export type SupportTokenClaims = z.infer<typeof supportTokenClaimsSchema>;

export interface SupportSessionResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly sessionId: string;
  readonly grantId: string;
  readonly grantExpiresAt: string;
}
