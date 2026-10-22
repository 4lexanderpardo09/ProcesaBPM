import { describe, expect, it } from 'vitest';
import { listTicketsQuerySchema, ticketCountsResponseSchema, ticketFiltersQuerySchema } from './list.js';

const ID = '018f0000-0000-7000-8000-000000000001';

describe('listTicketsQuerySchema', () => {
  it('defaults to the first page of the assigned view', () => {
    expect(listTicketsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, view: 'assigned' });
  });

  it('takes the inbox filters and trims the search', () => {
    expect(listTicketsQuerySchema.parse({ view: 'all', search: '  printer ', priorityId: ID, categoryId: ID, companyId: ID, status: 'OPEN' })).toMatchObject({ search: 'printer', priorityId: ID, categoryId: ID, companyId: ID, status: 'OPEN' });
  });

  it.each([
    ['a search of more than 100 characters', { search: 'a'.repeat(101) }],
    ['a blank search', { search: '   ' }],
    ['a priority that is not an id', { priorityId: 'high' }],
    ['an unknown view', { view: 'everything' }],
  ])('rejects %s', (_, query) => {
    expect(listTicketsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('ticketFiltersQuerySchema', () => {
  it('has no page nor view: the counts cover every view', () => {
    expect(ticketFiltersQuerySchema.parse({ view: 'all', page: '2', search: 'x' })).toEqual({ search: 'x' });
  });
});

describe('ticketCountsResponseSchema', () => {
  it('accepts a total per view', () => {
    const counts = { assigned: 1, created: 2, observed: 0, all: 3, history: 4, reopened: 1, errors_reported: 0, errors_received: 2 };
    expect(ticketCountsResponseSchema.parse(counts)).toEqual(counts);
  });

  it('rejects a missing view or a negative total', () => {
    expect(ticketCountsResponseSchema.safeParse({ assigned: 1, created: 2, all: 3 }).success).toBe(false);
    expect(ticketCountsResponseSchema.safeParse({ assigned: -1, created: 2, observed: 0, all: 3 }).success).toBe(false);
  });
});
