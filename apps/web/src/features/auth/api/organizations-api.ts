import { myOrganizationsResponseSchema, type Organization } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';

/** One the person can open now: a membership already accepted, in an organization that is open and not under maintenance. */
export const canOpen = (organization: Organization): boolean => organization.membershipStatus === 'ACTIVE' && organization.tenantStatus === 'ACTIVE' && organization.maintenance === null;

export function myOrganizationsQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: ['auth', 'organizations'] as const,
    queryFn: ({ signal }) => client.request('/auth/me/organizations', { schema: myOrganizationsResponseSchema, signal }),
    select: (response) => response.organizations,
    staleTime: 5 * 60_000,
  });
}
