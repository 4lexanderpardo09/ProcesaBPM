import type { MemberResponse } from '@procesabpm/shared';

/**
 * How a member is named on screen. Until an invitation is accepted the API sends no names (the person may already
 * exist with the names another organization gave them), so the e-mail stands in.
 */
export function memberName(member: Pick<MemberResponse, 'firstName' | 'lastName' | 'email'>): string {
  const name = `${member.firstName} ${member.lastName}`.trim();
  return name === '' ? member.email : name;
}
