import { ticketDetailResponseSchema, ticketEventResponseSchema, ticketSummaryResponseSchema } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type TicketDetailRow, type TicketEventRow, type TicketSummaryRow, toDetail, toEvent, toSummary } from './ticket-responses.js';

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

const detailRow = (overrides: Partial<TicketDetailRow> = {}): TicketDetailRow => ({
  ...row(),
  workflowId: id(10),
  workflowVersionId: id(11),
  registeredById: id(12),
  registeredBy: person('Marta', 'Ruiz'),
  descriptionHtml: '<p>Adjunto el comprobante.</p>',
  departmentId: id(13),
  department: { id: id(13), name: 'Cartera' },
  siteId: id(14),
  site: { id: id(14), name: 'Bogotá' },
  currentLoop: 1,
  closedById: null,
  closedBy: null,
  company: { id: id(2), name: 'Electrocréditos' },
  stepVisits: [{ id: id(15), stepId: id(5), loop: 1, enteredAt: new Date('2026-10-18T10:00:00.000Z'), dueAt: null, resumeAt: null }],
  parallelTasks: [{ id: id(16), userId: id(8), status: 'PENDING', completedAt: null, stepId: id(5), loop: 1, membership: person('Luis', 'Gómez') }],
  incidents: [],
  fieldValues: [],
  ...overrides,
});
const noValueNames = { users: {}, sites: {} };

describe('toDetail', () => {
  it('names the company, who registered it, department, site and the signers of the current step', () => {
    const detail = toDetail(detailRow(), now, noValueNames);
    expect(detail).toMatchObject({
      companyId: id(2),
      company: { id: id(2), name: 'Electrocréditos' },
      registeredById: id(12),
      registeredBy: { id: id(12), name: 'Marta Ruiz' },
      closedBy: null,
      department: { id: id(13), name: 'Cartera' },
      site: { id: id(14), name: 'Bogotá' },
      parallelTasks: [{ id: id(16), userId: id(8), name: 'Luis Gómez', status: 'PENDING' }],
    });
  });

  it('names both people of the open incident and keeps their ids', () => {
    const incident = { id: id(17), assignedToId: id(8), createdById: id(3), openedAt: now, description: '<p>Falta el soporte.</p>', assignedTo: person('Luis', 'Gómez'), createdBy: person('Ana', 'Pérez') };
    expect(toDetail(detailRow({ status: 'PAUSED', incidents: [incident] }), now, noValueNames).openIncident).toEqual({
      id: id(17),
      assignedToId: id(8),
      createdById: id(3),
      assignedTo: { id: id(8), name: 'Luis Gómez' },
      createdBy: { id: id(3), name: 'Ana Pérez' },
      openedAt: now.toISOString(),
      descriptionHtml: '<p>Falta el soporte.</p>',
    });
  });

  it('a ticket the creator registered, without department or site, has nulls', () => {
    expect(toDetail(detailRow({ registeredById: null, registeredBy: null, departmentId: null, department: null, siteId: null, site: null }), now, noValueNames)).toMatchObject({ registeredBy: null, department: null, site: null });
  });

  it('carries the value names it is given and, with the actions, matches the contract the web parses', () => {
    const valueNames = { users: { [id(8)]: 'Luis Gómez' }, sites: { [id(14)]: 'Bogotá' } };
    const detail = toDetail(detailRow({ closedById: id(3), closedBy: person('Ana', 'Pérez') }), now, valueNames);
    expect(detail.valueNames).toEqual(valueNames);
    expect(detail.closedBy).toEqual({ id: id(3), name: 'Ana Pérez' });
    const actions = { advance: true, take: false, reassign: false, close: true, openIncident: false, resolveIncident: false, reopen: false, signParallelTask: false, comment: true };
    expect(ticketDetailResponseSchema.safeParse({ ...detail, actions }).success).toBe(true);
  });
});

const eventRow = (overrides: Partial<TicketEventRow> = {}): TicketEventRow => ({
  id: id(20),
  type: 'ASSIGNED',
  stepId: id(5),
  transitionId: id(21),
  loop: 1,
  actorId: id(3),
  assigneeId: id(8),
  commentHtml: null,
  data: null,
  createdAt: now,
  actor: person('Ana', 'Pérez'),
  assignee: person('Luis', 'Gómez'),
  step: { id: id(5), name: 'Revisión' },
  transition: { id: id(21), label: 'Aprobar' },
  ...overrides,
});

describe('toEvent', () => {
  it('keeps the ids and names the actor, assignee, step and transition', () => {
    expect(toEvent(eventRow())).toMatchObject({
      actorId: id(3),
      assigneeId: id(8),
      actor: { id: id(3), name: 'Ana Pérez' },
      assignee: { id: id(8), name: 'Luis Gómez' },
      step: { id: id(5), name: 'Revisión' },
      transition: { id: id(21), name: 'Aprobar' },
      createdAt: now.toISOString(),
    });
  });

  it('an event of the system, outside any step, has nulls', () => {
    const event = toEvent(eventRow({ actorId: null, actor: null, assigneeId: null, assignee: null, stepId: null, step: null, transitionId: null, transition: null }));
    expect(event).toMatchObject({ actor: null, assignee: null, step: null, transition: null });
    expect(ticketEventResponseSchema.safeParse(event).success).toBe(true);
  });
});
