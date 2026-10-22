import { describe, expect, it } from 'vitest';
import { ticketDocumentResponseSchema } from '../files/schemas.js';
import { ticketFormResponseSchema } from './forms.js';
import { ticketCandidatesQuerySchema, ticketCandidatesResponseSchema, ticketDetailResponseSchema, ticketTimelineResponseSchema } from './schemas.js';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;

const detail = {
  id: id(1),
  number: 'T-1042',
  title: 'Confirmación de pago',
  status: 'OPEN',
  companyId: id(2),
  creatorId: id(3),
  subcategoryId: id(4),
  currentStepId: id(5),
  createdAt: '2026-10-18T10:00:00.000Z',
  closedAt: null,
  tags: [],
  creator: { id: id(3), name: 'Ana Pérez' },
  subcategory: { id: id(4), name: 'Pagos', category: { id: id(11), name: 'Cartera' } },
  currentStep: { id: id(5), name: 'Revisión' },
  priority: null,
  sla: null,
  workflowId: id(6),
  workflowVersionId: id(7),
  registeredById: null,
  descriptionHtml: '<p>Adjunto el comprobante.</p>',
  priorityId: null,
  departmentId: null,
  siteId: null,
  currentLoop: 0,
  closedById: null,
  openVisit: { id: id(8), stepId: id(5), loop: 0, enteredAt: '2026-10-18T10:00:00.000Z', dueAt: null },
  assignees: [{ userId: id(3), name: 'Ana Pérez', type: 'PRIMARY', assignedAt: '2026-10-18T10:00:00.000Z' }],
  awaitingDispatch: false,
  parallelTasks: [],
  openIncident: null,
  waitingUntil: null,
  values: { amount: '1250000.00' },
  totals: {},
  company: { id: id(2), name: 'Electrocréditos' },
  registeredBy: null,
  closedBy: null,
  department: null,
  site: { id: id(14), name: 'Bogotá' },
  valueNames: { users: { [id(15)]: 'Luis Gómez' }, sites: {}, companies: {}, departments: {}, positions: {} },
  actions: { advance: true, take: false, reassign: false, close: true, openIncident: true, resolveIncident: false, reopen: false, signParallelTask: false, comment: true, reportError: false, edit: false },
};

describe('ticketDetailResponseSchema', () => {
  it('accepts a ticket with its open visit, assignees and values', () => {
    expect(ticketDetailResponseSchema.parse(detail).openVisit?.id).toBe(id(8));
  });

  it('accepts an open incident with the names of both people', () => {
    const openIncident = { id: id(16), assignedToId: id(15), createdById: id(3), assignedTo: { id: id(15), name: 'Luis Gómez' }, createdBy: { id: id(3), name: 'Ana Pérez' }, openedAt: '2026-10-18T11:00:00.000Z', descriptionHtml: '<p>Falta el soporte.</p>' };
    expect(ticketDetailResponseSchema.parse({ ...detail, status: 'PAUSED', openIncident }).openIncident?.assignedTo.name).toBe('Luis Gómez');
  });

  it('requires the names of the values, even when there are none', () => {
    const { valueNames: _, ...withoutNames } = detail;
    expect(ticketDetailResponseSchema.safeParse(withoutNames).success).toBe(false);
    expect(ticketDetailResponseSchema.safeParse({ ...detail, valueNames: { users: { [id(15)]: 7 }, sites: {}, companies: {}, departments: {}, positions: {} } }).success).toBe(false);
  });

  it('requires every action flag, as a boolean', () => {
    const { actions: _, ...withoutActions } = detail;
    expect(ticketDetailResponseSchema.safeParse(withoutActions).success).toBe(false);
    const { comment: __, ...missingOne } = detail.actions;
    expect(ticketDetailResponseSchema.safeParse({ ...detail, actions: missingOne }).success).toBe(false);
    expect(ticketDetailResponseSchema.safeParse({ ...detail, actions: { ...detail.actions, take: 'yes' } }).success).toBe(false);
  });

  it('rejects an assignee type outside the engine ones', () => {
    expect(ticketDetailResponseSchema.safeParse({ ...detail, assignees: [{ ...detail.assignees[0], type: 'OWNER' }] }).success).toBe(false);
  });
});

describe('ticketTimelineResponseSchema', () => {
  it('accepts events with or without an actor and a comment', () => {
    const event = {
      id: id(9),
      type: 'CREATED',
      stepId: id(5),
      transitionId: null,
      loop: 0,
      actorId: id(3),
      assigneeId: null,
      commentHtml: null,
      data: {},
      createdAt: '2026-10-18T10:00:00.000Z',
      actor: { id: id(3), name: 'Ana Pérez' },
      assignee: null,
      step: { id: id(5), name: 'Revisión' },
      transition: null,
    };
    expect(ticketTimelineResponseSchema.parse([event, { ...event, id: id(10), type: 'COMMENTED', actorId: null, actor: null, commentHtml: '<p>Hola</p>' }])).toHaveLength(2);
  });

  it('rejects an event without the names of its actor and step', () => {
    const event = { id: id(9), type: 'CREATED', stepId: null, transitionId: null, loop: 0, actorId: id(3), assigneeId: null, commentHtml: null, data: {}, createdAt: '2026-10-18T10:00:00.000Z' };
    expect(ticketTimelineResponseSchema.safeParse([event]).success).toBe(false);
  });
});

describe('ticketFormResponseSchema', () => {
  it('accepts a closed ticket without a step', () => {
    expect(ticketFormResponseSchema.parse({ ticketId: id(1), versionId: id(7), visitId: null, step: null, fields: [], editableFieldCodes: [], decisions: [] }).step).toBeNull();
  });

  it('rejects a field type the builder does not have', () => {
    const field = { id: id(11), stepId: id(5), code: 'amount', label: 'Monto', type: 'MONEY', isRequired: true, isReadOnly: false, sortOrder: 1, config: {}, dataSource: null };
    expect(ticketFormResponseSchema.safeParse({ ticketId: id(1), versionId: id(7), visitId: id(8), step: null, fields: [field], editableFieldCodes: [], decisions: [] }).success).toBe(false);
  });
});

describe('ticketDocumentResponseSchema', () => {
  it('accepts an attachment with its stored file', () => {
    const file = { id: id(12), name: 'comprobante.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 2048, status: 'CONFIRMED', createdAt: '2026-10-18T10:00:00.000Z', confirmedAt: '2026-10-18T10:00:01.000Z' };
    const document = { id: id(13), role: 'ATTACHMENT', eventId: null, stepId: null, fieldCode: null, version: 1, isCurrent: true, createdAt: '2026-10-18T10:00:00.000Z', file };
    expect(ticketDocumentResponseSchema.parse(document).file.name).toBe('comprobante.pdf');
  });
});

describe('ticket candidates', () => {
  it('asks for one of the two purposes', () => {
    expect(ticketCandidatesQuerySchema.parse({ for: 'reassign' })).toEqual({ for: 'reassign' });
    expect(ticketCandidatesQuerySchema.parse({ for: 'incident' })).toEqual({ for: 'incident' });
    expect(ticketCandidatesQuerySchema.safeParse({ for: 'everyone' }).success).toBe(false);
    expect(ticketCandidatesQuerySchema.safeParse({}).success).toBe(false);
  });

  it('answers people by id and name', () => {
    expect(ticketCandidatesResponseSchema.parse([{ id: id(15), name: 'Luis Gómez' }])).toEqual([{ id: id(15), name: 'Luis Gómez' }]);
    expect(ticketCandidatesResponseSchema.safeParse([{ id: id(15) }]).success).toBe(false);
  });
});
