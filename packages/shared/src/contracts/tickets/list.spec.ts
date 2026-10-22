import { describe, expect, it } from 'vitest';
import { fieldRangeKind, listTicketsQuerySchema, ticketCountsResponseSchema, ticketFiltersQuerySchema } from './list.js';

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

describe('the field filter', () => {
  const parse = (query: Record<string, string>) => ticketFiltersQuerySchema.safeParse(query).success;

  it('takes a code with its operator and the values it needs', () => {
    expect(parse({ fieldCode: 'DUE_ON', fieldOperator: 'between', fieldValue: '2026-01-01', fieldValueTo: '2026-01-31' })).toBe(true);
    expect(parse({ fieldCode: 'DUE_ON', fieldOperator: 'between', fieldValueTo: '2026-01-31' })).toBe(true);
    expect(parse({ fieldCode: 'AMOUNT', fieldOperator: 'between', fieldValue: '-5.5' })).toBe(true);
    expect(parse({ fieldCode: 'REF', fieldOperator: 'contains', fieldValue: ' fac ' })).toBe(true);
    expect(parse({ fieldCode: 'REF', fieldOperator: 'empty' })).toBe(true);
  });

  it.each([
    ['a code alone', { fieldCode: 'REF' }],
    ['an operator alone', { fieldOperator: 'filled' }],
    ['a value alone', { fieldValue: 'x' }],
    ['equals without a value', { fieldCode: 'REF', fieldOperator: 'equals' }],
    ['contains with an end', { fieldCode: 'REF', fieldOperator: 'contains', fieldValue: 'a', fieldValueTo: 'b' }],
    ['a range without ends', { fieldCode: 'REF', fieldOperator: 'between' }],
    ['a range of words', { fieldCode: 'REF', fieldOperator: 'between', fieldValue: 'a' }],
    ['filled with a value', { fieldCode: 'REF', fieldOperator: 'filled', fieldValue: 'x' }],
    ['a lowercase code', { fieldCode: 'ref', fieldOperator: 'filled' }],
  ])('rejects %s', (_, query) => {
    expect(parse(query)).toBe(false);
  });
});

describe('fieldRangeKind', () => {
  it('tells dates from numbers, and refuses a mix, an impossible date or ends out of order', () => {
    expect(fieldRangeKind('2026-02-01', '2026-02-28')).toBe('date');
    expect(fieldRangeKind(undefined, '10')).toBe('number');
    expect(fieldRangeKind('2026-02-01', '10')).toBeUndefined();
    expect(fieldRangeKind('2026-13-01', undefined)).toBeUndefined();
    expect(fieldRangeKind('2026-03-01', '2026-02-01')).toBeUndefined();
    expect(fieldRangeKind('9', '10')).toBe('number');
    expect(fieldRangeKind(undefined, undefined)).toBeUndefined();
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
