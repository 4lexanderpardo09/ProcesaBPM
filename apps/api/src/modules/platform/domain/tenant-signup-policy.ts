export const PLATFORM_AUDIT_ACTIONS = {
  tenantCreated: 'tenant.created',
  tenantSuspended: 'tenant.suspended',
  tenantReactivated: 'tenant.reactivated',
  tenantPlanChanged: 'tenant.plan_changed',
  tenantExtraStorageChanged: 'tenant.extra_storage_changed',
  tenantOwnerInvitationResent: 'tenant.owner_invitation_resent',
  planUpdated: 'plan.updated',
  adminInvited: 'platform_admin.invited',
  adminRevoked: 'platform_admin.revoked',
} as const;

/** Calendar year of `instant` as lived in `timeZone` (the holidays of the country follow its calendar). */
export function calendarYearIn(timeZone: string, instant: Date): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(instant));
}
