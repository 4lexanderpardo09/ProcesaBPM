import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { buildAbility } from '../../authorization/domain/build-ability.js';
import { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import type { TicketQueryRepository } from '../data/ticket-query.repository.js';
import { ticketSubject } from '../domain/ticket-subject.js';
import { readableTickets } from './ticket-access.js';
import { TicketVisibility } from './ticket-visibility.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const USER = '0199a000-0000-7000-8000-000000000002';
const TICKET = '0199a000-0000-7000-8000-000000000003';
const principal: Principal = { userId: USER, tenantId: TENANT, sessionId: 's', roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null }, tenantMode: 'ACTIVE' };
const { ability } = buildAbility([{ action: 'read_created', subject: 'Ticket', conditions: null }], { userId: USER, membership: principal.membership }, new SubjectRegistry().register('Ticket', ticketSubject));

function setUp(rows: { summary?: unknown; ids?: string[] } = {}) {
  const context = new TenantContext();
  const tx = {} as TenantTransaction;
  const scopes: unknown[] = [];
  const runner = { withTenantTransaction: vi.fn(<T>(work: (tx: TenantTransaction) => Promise<T>) => (scopes.push(context.current()), work(tx))) } as unknown as TenantTransactionRunner;
  const tickets = {
    findRealtimeSummary: vi.fn(() => Promise.resolve(rows.summary ?? null)),
    readableIds: vi.fn(() => Promise.resolve(rows.ids ?? [])),
  } as unknown as TicketQueryRepository;
  return { visibility: new TicketVisibility(context, runner, tickets), tickets, scopes, tx };
}

describe('TicketVisibility', () => {
  it('reads the summary as the member, in their tenant, with the same filter as GET /tickets/:id', async () => {
    const summary = { id: TICKET, status: 'OPEN', currentStepId: 'step', currentLoop: 1, assignees: [{ userId: USER, type: 'RESPONSIBLE' }], events: [{ seq: 42n }] };
    const { visibility, tickets, scopes, tx } = setUp({ summary });
    expect(await visibility.summaryIfReadable(principal, ability, TICKET)).toEqual({ ticketId: TICKET, status: 'OPEN', currentStepId: 'step', currentLoop: 1, assignees: [{ userId: USER, type: 'RESPONSIBLE' }], lastEventSeq: '42' });
    expect(scopes).toEqual([{ tenantId: TENANT, userId: USER }]);
    expect(tickets.findRealtimeSummary).toHaveBeenCalledWith(tx, TENANT, TICKET, readableTickets(ability));
  });

  it('answers undefined for a ticket the filter hides (unreadable, foreign or missing alike)', async () => {
    const { visibility } = setUp();
    expect(await visibility.summaryIfReadable(principal, ability, TICKET)).toBeUndefined();
  });

  it('readableIds keeps what the database lets through and asks nothing for an empty list', async () => {
    const { visibility, tickets } = setUp({ ids: [TICKET] });
    expect(await visibility.readableIds(principal, ability, [])).toEqual(new Set());
    expect(tickets.readableIds).not.toHaveBeenCalled();
    expect(await visibility.readableIds(principal, ability, [TICKET, USER])).toEqual(new Set([TICKET]));
    expect(tickets.readableIds).toHaveBeenCalledWith(expect.anything(), TENANT, [TICKET, USER], readableTickets(ability));
  });
});
