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
  currentStepId: null,
  createdAt: '2026-10-18T10:00:00.000Z',
  closedAt: null,
  tags: [{ id: '018f0000-0000-7000-8000-000000000005', name: 'Urgente', color: '#be123c' }],
};

describe('ticketPageResponseSchema', () => {
  it('accepts a page of ticket summaries', () => {
    expect(ticketPageResponseSchema.parse({ items: [summary], page: 1, pageSize: 25, total: 1 }).items[0]?.number).toBe('T-1042');
  });

  it('rejects a status outside the ticket states', () => {
    expect(ticketPageResponseSchema.safeParse({ items: [{ ...summary, status: 'DONE' }], page: 1, pageSize: 25, total: 1 }).success).toBe(false);
  });

  it('rejects a page without its total', () => {
    expect(ticketPageResponseSchema.safeParse({ items: [], page: 1, pageSize: 25 }).success).toBe(false);
  });
});
