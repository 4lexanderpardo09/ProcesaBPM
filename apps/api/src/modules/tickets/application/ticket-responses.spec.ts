import { ticketSummaryResponseSchema } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type TicketSummaryRow, toSummary } from './ticket-responses.js';

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-18T12:00:00.000Z');
const person = (firstName: string, lastName: string) => ({ user: { firstName, lastName } });

const row = (overrides: Partial<TicketSummaryRow> = {}): TicketSummaryRow => ({
  id: id(1),
  number: 1042n,
  title: 'Confirmación de pago',
  status: 'OPEN',
  companyId: id(2),
  creatorId: id(3),
  subcategoryId: id(4),
  currentStepId: id(5),
  priorityId: id(6),
  createdAt: new Date('2026-10-18T10:00:00.000Z'),
  closedAt: null,
  tags: [],
  creator: person('Ana', 'Pérez'),
  subcategory: { name: 'Pagos', category: { id: id(7), name: 'Cartera' } },
  currentStep: { id: id(5), name: 'Revisión' },
  priority: { id: id(6), name: 'Alta', color: '#be123c' },
  assignees: [{ userId: id(8), type: 'PRIMARY', assignedAt: new Date('2026-10-18T10:05:00.000Z'), membership: person('Luis', 'Gómez') }],
  slaClocks: [{ dueAt: new Date('2026-10-18T11:00:00.000Z'), pausedAt: null }],
  ...overrides,
});

describe('toSummary', () => {
  it('keeps the flat ids and adds the names the inbox shows', () => {
    const summary = toSummary(row(), now);
    expect(summary).toMatchObject({
      number: '1042',
      creatorId: id(3),
      subcategoryId: id(4),
      currentStepId: id(5),
      priorityId: id(6),
      creator: { id: id(3), name: 'Ana Pérez' },
      subcategory: { id: id(4), name: 'Pagos', category: { id: id(7), name: 'Cartera' } },
      currentStep: { id: id(5), name: 'Revisión' },
      priority: { id: id(6), name: 'Alta', color: '#be123c' },
      assignees: [{ userId: id(8), name: 'Luis Gómez', type: 'PRIMARY', assignedAt: '2026-10-18T10:05:00.000Z' }],
    });
  });

  it('carries the SLA of the current step', () => {
    expect(toSummary(row(), now).sla).toEqual({ dueAt: '2026-10-18T11:00:00.000Z', overdue: true, paused: false });
    expect(toSummary(row({ slaClocks: [] }), now).sla).toBeNull();
  });

  it('a ticket without step or priority, and nobody holding it, has nulls and an empty list', () => {
    const summary = toSummary(row({ status: 'CLOSED', closedAt: now, currentStepId: null, currentStep: null, priorityId: null, priority: null, assignees: [], slaClocks: [] }), now);
    expect(summary).toMatchObject({ currentStep: null, priority: null, assignees: [], sla: null, closedAt: now.toISOString() });
  });

  it('matches the contract the web parses', () => {
    expect(ticketSummaryResponseSchema.safeParse(toSummary(row(), now)).success).toBe(true);
  });
});
