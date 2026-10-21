import { NotFoundError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { buildAbility } from '../../authorization/domain/build-ability.js';
import type { TicketActionStateReader } from '../../engine/application/ticket-action-state.reader.js';
import type { TicketActionState } from '../../engine/domain/ticket-actions.js';
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

const TICKET = '0199a000-0000-7000-8000-000000000004';
const PICKED_USER = '0199a000-0000-7000-8000-000000000005';
const PICKED_SITE = '0199a000-0000-7000-8000-000000000006';

/** A closed ticket the caller may only comment on. */
const closedState: TicketActionState = {
  actorId: USER, status: 'CLOSED', companyId: CATEGORY, visit: null, step: undefined, hasDecisionExit: false, assignees: [], signatures: [], openIncident: null, hasReopenTarget: true,
  grants: { transition: false, reassign: false, close: false, open_incident: false, reopen: false, comment: true },
};

function setUp(totals: readonly number[] = [0, 0, 0, 0], detail: unknown = null) {
  const context = new TenantContext();
  const tx = {} as TenantTransaction;
  const runner = { withTenantTransaction: vi.fn(<T>(work: (tx: TenantTransaction) => Promise<T>) => work(tx)) } as unknown as TenantTransactionRunner;
  const remaining = [...totals];
  const tickets = {
    count: vi.fn(() => Promise.resolve(remaining.shift() ?? 0)),
    list: vi.fn(() => Promise.resolve({ rows: [], total: 0 })),
    findDetail: vi.fn(() => Promise.resolve(detail)),
    memberNames: vi.fn(() => Promise.resolve(new Map([[PICKED_USER, 'Luis Gómez']]))),
    siteNames: vi.fn(() => Promise.resolve(new Map())),
    presetNames: vi.fn(() => Promise.resolve(new Map())),
  } as unknown as TicketQueryRepository;
  const actionStates = { read: vi.fn(() => Promise.resolve(closedState)) } as unknown as TicketActionStateReader;
  const service = new TicketQueriesService(runner, context, tickets, new Clock(), actionStates);
  const inTenant = <T>(work: () => Promise<T>) => context.run({ tenantId: TENANT, userId: USER }, work);
  return { service, tickets, runner, tx, inTenant, actionStates };
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

  describe('get', () => {
    const person = (firstName: string) => ({ user: { firstName, lastName: 'Pérez' } });
    const detailRow = {
      id: TICKET, number: 1n, title: 't', status: 'OPEN', companyId: CATEGORY, creatorId: USER, subcategoryId: CATEGORY, currentStepId: null, priorityId: null,
      createdAt: new Date(), closedAt: null, tags: [], creator: person('Ana'), subcategory: { name: 's', category: { id: CATEGORY, name: 'c' } }, currentStep: null, priority: null,
      assignees: [], slaClocks: [], workflowId: CATEGORY, workflowVersionId: CATEGORY, registeredById: null, registeredBy: null, descriptionHtml: '', departmentId: null, department: null,
      siteId: null, site: null, currentLoop: 1, closedById: null, closedBy: null, company: { id: CATEGORY, name: 'Co' }, stepVisits: [], parallelTasks: [], incidents: [],
      fieldValues: [
        { value: PICKED_USER, field: { code: 'approver', type: 'USER', config: {}, dataSource: null } },
        { value: PICKED_SITE, field: { code: 'branch', type: 'SITE', config: {}, dataSource: null } },
      ],
    };

    it('names the people and sites of the values in the same transaction and tenant, leaving out what it does not find', async () => {
      const { service, tickets, runner, tx, inTenant } = setUp(undefined, detailRow);
      const detail = await inTenant(() => service.get(ability, TICKET, USER));
      expect(runner.withTenantTransaction).toHaveBeenCalledTimes(1);
      expect(tickets.memberNames).toHaveBeenCalledWith(tx, TENANT, [PICKED_USER]);
      expect(tickets.siteNames).toHaveBeenCalledWith(tx, TENANT, [PICKED_SITE]);
      expect(detail.valueNames).toEqual({ users: { [PICKED_USER]: 'Luis Gómez' }, sites: {}, companies: {}, departments: {}, positions: {} });
    });

    it('a ticket the caller cannot read is not found, and nothing else is looked up', async () => {
      const { service, tickets, actionStates, inTenant } = setUp();
      await expect(inTenant(() => service.get(ability, TICKET, USER))).rejects.toBeInstanceOf(NotFoundError);
      expect(tickets.memberNames).not.toHaveBeenCalled();
      expect(actionStates.read).not.toHaveBeenCalled();
    });

    it('adds what the caller may do, judged in the same transaction as the caller', async () => {
      const { service, actionStates, tx, inTenant } = setUp(undefined, detailRow);
      const detail = await inTenant(() => service.get(ability, TICKET, USER));
      expect(actionStates.read).toHaveBeenCalledWith(tx, TENANT, TICKET, expect.objectContaining({ userId: USER }));
      expect(detail.actions).toEqual({ advance: false, take: false, reassign: false, close: false, openIncident: false, resolveIncident: false, reopen: false, signParallelTask: false, comment: true });
    });

    it('the body alone does not judge the actions', async () => {
      const { service, actionStates, inTenant } = setUp(undefined, detailRow);
      expect(await inTenant(() => service.getBody(ability, TICKET, USER))).not.toHaveProperty('actions');
      expect(actionStates.read).not.toHaveBeenCalled();
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
