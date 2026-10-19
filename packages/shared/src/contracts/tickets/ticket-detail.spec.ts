import { describe, expect, it } from 'vitest';
import { ticketDocumentResponseSchema } from '../files/schemas.js';
import { ticketFormResponseSchema } from './forms.js';
import { ticketDetailResponseSchema, ticketTimelineResponseSchema } from './schemas.js';

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
};

describe('ticketDetailResponseSchema', () => {
  it('accepts a ticket with its open visit, assignees and values', () => {
    expect(ticketDetailResponseSchema.parse(detail).openVisit?.id).toBe(id(8));
  });

  it('rejects an assignee type outside the engine ones', () => {
    expect(ticketDetailResponseSchema.safeParse({ ...detail, assignees: [{ ...detail.assignees[0], type: 'OWNER' }] }).success).toBe(false);
  });
});

describe('ticketTimelineResponseSchema', () => {
  it('accepts events with or without an actor and a comment', () => {
    const event = { id: id(9), type: 'CREATED', stepId: null, transitionId: null, loop: 0, actorId: id(3), assigneeId: null, commentHtml: null, data: {}, createdAt: '2026-10-18T10:00:00.000Z' };
    expect(ticketTimelineResponseSchema.parse([event, { ...event, id: id(10), type: 'COMMENTED', actorId: null, commentHtml: '<p>Hola</p>' }])).toHaveLength(2);
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
