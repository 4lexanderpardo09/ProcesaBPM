import { describe, expect, it } from 'vitest';
import { ticketPageResponseSchema } from './schemas.js';

const summary = {
  id: '018f0000-0000-7000-8000-000000000001',
  number: 'T-1042',
  title: 'Confirmación de pago',
  status: 'OPEN',
  companyId: '018f0000-0000-7000-8000-000000000002',
  creatorId: '018f0000-0000-7000-8000-000000000003',
  subcategoryId: '018f0000-0000-7000-8000-000000000004',
  currentStepId: '018f0000-0000-7000-8000-000000000006',
  priorityId: null,
  createdAt: '2026-10-18T10:00:00.000Z',
  closedAt: null,
  tags: [{ id: '018f0000-0000-7000-8000-000000000005', name: 'Urgente', color: '#be123c' }],
  creator: { id: '018f0000-0000-7000-8000-000000000003', name: 'Ana Pérez' },
  subcategory: { id: '018f0000-0000-7000-8000-000000000004', name: 'Pagos', category: { id: '018f0000-0000-7000-8000-000000000007', name: 'Cartera' } },
  currentStep: { id: '018f0000-0000-7000-8000-000000000006', name: 'Revisión' },
  priority: null,
  workflowPriority: null,
  lastActivityAt: '2026-10-17T16:00:00.000Z',
  filteredValue: null,
  assignees: [{ userId: '018f0000-0000-7000-8000-000000000008', name: 'Luis Gómez', type: 'PRIMARY', assignedAt: '2026-10-18T10:05:00.000Z' }],
  sla: { dueAt: '2026-10-19T10:00:00.000Z', overdue: false, paused: false },
};

describe('ticketPageResponseSchema', () => {
  it('accepts a page of ticket summaries', () => {
    expect(ticketPageResponseSchema.parse({ items: [summary], page: 1, pageSize: 25, total: 1 }).items[0]?.number).toBe('T-1042');
  });

  it('rejects a status outside the ticket states', () => {
    expect(ticketPageResponseSchema.safeParse({ items: [{ ...summary, status: 'DONE' }], page: 1, pageSize: 25, total: 1 }).success).toBe(false);
  });

  it('accepts a ticket without step, priority, assignees or SLA (closed)', () => {
    const closed = { ...summary, status: 'CLOSED', closedAt: '2026-10-18T11:00:00.000Z', currentStepId: null, currentStep: null, assignees: [], sla: null };
    expect(ticketPageResponseSchema.safeParse({ items: [closed], page: 1, pageSize: 25, total: 1 }).success).toBe(true);
  });

  it('rejects an assignee without a name or of an unknown type', () => {
    const [assignee] = summary.assignees;
    expect(ticketPageResponseSchema.safeParse({ items: [{ ...summary, assignees: [{ ...assignee, name: undefined }] }], page: 1, pageSize: 25, total: 1 }).success).toBe(false);
    expect(ticketPageResponseSchema.safeParse({ items: [{ ...summary, assignees: [{ ...assignee, type: 'OWNER' }] }], page: 1, pageSize: 25, total: 1 }).success).toBe(false);
  });

  it('rejects a page without its total', () => {
    expect(ticketPageResponseSchema.safeParse({ items: [], page: 1, pageSize: 25 }).success).toBe(false);
  });
});
