import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { buildAbility } from '../../authorization/domain/build-ability.js';
import { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import type { TicketQueryRepository, Where } from '../data/ticket-query.repository.js';
import { ticketFilters, viewFilter } from '../domain/ticket-list-filters.js';
import { ticketSubject } from '../domain/ticket-subject.js';
import { readableTickets } from './ticket-access.js';
import { TicketQueriesService } from './ticket-queries.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const USER = '0199a000-0000-7000-8000-000000000002';
const CATEGORY = '0199a000-0000-7000-8000-000000000003';
const principal: Principal = { userId: USER, tenantId: TENANT, sessionId: 's', roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null }, tenantMode: 'ACTIVE' };
const { ability } = buildAbility([{ action: 'read_created', subject: 'Ticket', conditions: null }], { userId: USER, membership: principal.membership }, new SubjectRegistry().register('Ticket', ticketSubject));
const query = { status: 'OPEN' as const, search: 'printer', categoryId: CATEGORY };

function setUp(totals: readonly number[] = [0, 0, 0, 0]) {
  const context = new TenantContext();
  const tx = {} as TenantTransaction;
  const runner = { withTenantTransaction: vi.fn(<T>(work: (tx: TenantTransaction) => Promise<T>) => work(tx)) } as unknown as TenantTransactionRunner;
  const remaining = [...totals];
  const tickets = {
    count: vi.fn(() => Promise.resolve(remaining.shift() ?? 0)),
    list: vi.fn(() => Promise.resolve({ rows: [], total: 0 })),
  } as unknown as TicketQueryRepository;
  const service = new TicketQueriesService(runner, context, tickets);
  const inTenant = <T>(work: () => Promise<T>) => context.run({ tenantId: TENANT, userId: USER }, work);
  return { service, tickets, runner, tx, inTenant };
}

const expectedFilters = (view: 'assigned' | 'created' | 'observed' | 'all'): Where[] => [viewFilter(view, principal), ...ticketFilters(query), readableTickets(ability)];

describe('TicketQueriesService', () => {
  describe('counts', () => {
    it('counts every view in one transaction, each with the view, the inbox filters and the access filter', async () => {
      const { service, tickets, runner, tx, inTenant } = setUp([3, 4, 0, 7]);
      expect(await inTenant(() => service.counts(principal, ability, query))).toEqual({ assigned: 3, created: 4, observed: 0, all: 7 });
      expect(runner.withTenantTransaction).toHaveBeenCalledTimes(1);
      expect(vi.mocked(tickets.count).mock.calls).toEqual([
        [tx, TENANT, expectedFilters('assigned')],
        [tx, TENANT, expectedFilters('created')],
        [tx, TENANT, expectedFilters('observed')],
        [tx, TENANT, expectedFilters('all')],
      ]);
    });
  });

  describe('list', () => {
    it('reads the page with the same filters as the counts of its view', async () => {
      const { service, tickets, tx, inTenant } = setUp();
      await inTenant(() => service.list(principal, ability, { ...query, view: 'created', page: 2, pageSize: 10 }));
      expect(tickets.list).toHaveBeenCalledWith(tx, TENANT, expectedFilters('created'), { skip: 10, take: 10 }, USER);
    });

    it('always ends with the access filter, so no filter can widen it', async () => {
      const { service, tickets, inTenant } = setUp();
      await inTenant(() => service.list(principal, ability, { view: 'all', page: 1, pageSize: 25 }));
      const filters = vi.mocked(tickets.list).mock.calls[0]![2];
      expect(filters).toEqual([{}, readableTickets(ability)]);
    });
  });
});
