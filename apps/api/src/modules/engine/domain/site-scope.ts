import type { SiteScope } from '@procesabpm/shared';

export interface SiteCandidate {
  readonly userId: string;
  readonly siteId: string | null;
}

/**
 * Candidates allowed by the site scope of a step, relative to the site of the ticket.
 * - ANY_SITE, or a ticket without a site (tenants that do not use sites): nobody is filtered out.
 * - SAME_SITE: only members of the ticket's site.
 * - PARENT_SITE: the ticket's site, and if nobody is there, the nearest ancestor that has candidates.
 * Members without a site never match a site-bound scope. `ancestry` lists the ticket's site first, then its parents.
 */
export function filterBySiteScope<T extends SiteCandidate>(candidates: readonly T[], scope: SiteScope, ticketSiteId: string | null, ancestry: readonly string[]): T[] {
  if (scope === 'ANY_SITE' || ticketSiteId === null) return [...candidates];
  if (scope === 'SAME_SITE') return candidates.filter((candidate) => candidate.siteId === ticketSiteId);
  for (const siteId of ancestry) {
    const here = candidates.filter((candidate) => candidate.siteId === siteId);
    if (here.length > 0) return here;
  }
  return [];
}
