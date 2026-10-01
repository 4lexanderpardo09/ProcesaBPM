export const INVITATION_EMAIL_EVENT = 'email.invitation';

/** The owner's invitation link lives a week: a new customer may need time to open it. */
export const OWNER_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const PLATFORM_AUDIT_ACTIONS = {
  tenantCreated: 'tenant.created',
  tenantSuspended: 'tenant.suspended',
  tenantReactivated: 'tenant.reactivated',
} as const;

/** Calendar year of `instant` as lived in `timeZone` (the holidays of the country follow its calendar). */
export function calendarYearIn(timeZone: string, instant: Date): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(instant));
}
