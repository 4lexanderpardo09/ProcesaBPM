import { NotFoundError, type WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { buildAbility } from '../../authorization/domain/build-ability.js';
import { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import type { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import type { TicketFlowRepository } from '../data/ticket-flow.repository.js';
import { ticketSubject } from '../domain/ticket-subject.js';
import { readableTickets } from './ticket-access.js';
import { TicketFlowService } from './ticket-flow.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const USER = '0199a000-0000-7000-8000-000000000002';
const TICKET = '0199a000-0000-7000-8000-000000000003';
const VERSION = '0199a000-0000-7000-8000-000000000004';
const { ability } = buildAbility([{ action: 'read_created', subject: 'Ticket', conditions: null }], { userId: USER, membership: { departmentId: null, siteId: null, positionId: null } }, new SubjectRegistry().register('Ticket', ticketSubject));

const document = {
  steps: [
    { id: 'start', type: 'START', name: 'Start', ui: { x: 0, y: 0 } },
    { id: 'task', type: 'TASK', name: 'Task', ui: { x: 1, y: 0 } },
  ],
  transitions: [{ id: 't1', fromStepId: 'start', toStepId: 'task', type: 'DEFAULT', label: 'Next', uiPoints: null }],
  fields: [],
  amountRules: [],
} as unknown as WorkflowVersionDocument;

function setUp(row: Awaited<ReturnType<TicketFlowRepository['findProgress']>>) {
  const context = new TenantContext();
  const tx = {} as TenantTransaction;
  const runner = { withTenantTransaction: vi.fn(<T>(work: (tx: TenantTransaction) => Promise<T>) => work(tx)) } as unknown as TenantTransactionRunner;
  const tickets = { findProgress: vi.fn(() => Promise.resolve(row)) } as unknown as TicketFlowRepository;
  const versions = { documentOf: vi.fn(() => Promise.resolve(document)) } as unknown as PublishedVersionReader;
  const service = new TicketFlowService(runner, context, tickets, versions);
  const inTenant = <T>(work: () => Promise<T>) => context.run({ tenantId: TENANT, userId: USER }, work);
  return { service, tickets, versions, tx, inTenant };
}

describe('TicketFlowService', () => {
  it('reads the ticket under the access filter and maps its progress on the version it runs on, in one transaction', async () => {
    const row = { id: TICKET, status: 'OPEN' as const, workflowVersionId: VERSION, currentStepId: 'task', stepVisits: [{ stepId: 'task' }], events: [{ transitionId: 't1' }] };
    const { service, tickets, versions, tx, inTenant } = setUp(row);
    const flow = await inTenant(() => service.flow(ability, TICKET));
    expect(tickets.findProgress).toHaveBeenCalledWith(tx, TENANT, TICKET, readableTickets(ability));
    expect(versions.documentOf).toHaveBeenCalledWith(tx, TENANT, VERSION);
    expect(flow).toMatchObject({ ticketId: TICKET, versionId: VERSION, currentStepId: 'task' });
    expect(flow.steps.map((step) => step.passCount)).toEqual([1, 1]);
    expect(flow.transitions[0]?.takenCount).toBe(1);
  });

  it('a ticket the caller may not read (or that does not exist) is 404, and the version is never loaded', async () => {
    const { service, versions, inTenant } = setUp(null);
    await expect(inTenant(() => service.flow(ability, TICKET))).rejects.toBeInstanceOf(NotFoundError);
    expect(versions.documentOf).not.toHaveBeenCalled();
  });
});
