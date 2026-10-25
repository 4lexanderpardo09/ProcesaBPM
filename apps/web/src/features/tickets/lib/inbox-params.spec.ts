import { describe, expect, it } from 'vitest';
import { apiFieldFilter, type FieldOperator, filterQuery, NO_FILTERS, readInboxParams, writeInboxParams } from './inbox-params';

const read = (query: string) => readInboxParams(new URLSearchParams(query));
const PRIORITY = '018f0000-0000-7000-8000-000000000001';
const CATEGORY = '018f0000-0000-7000-8000-000000000002';
const COMPANY = '018f0000-0000-7000-8000-000000000003';
const defaults = { view: 'assigned', page: 1, sort: 'lastActivity', direction: 'desc', ...NO_FILTERS } as const;

describe('readInboxParams', () => {
  it('opens on the assigned tickets, no filters, first page', () => {
    expect(read('')).toEqual(defaults);
  });

  it('reads the view, the filters and the page', () => {
    expect(read(`view=observed&status=PAUSED&q=%20cuenta%20&priority=${PRIORITY}&category=${CATEGORY}&company=${COMPANY}&page=3`)).toEqual({
      view: 'observed',
      status: 'PAUSED',
      search: 'cuenta',
      searchMessages: false,
      priorityId: PRIORITY,
      categoryId: CATEGORY,
      companyId: COMPANY,
      page: 3,
      sort: 'lastActivity',
      direction: 'desc',
    });
  });

  it.each([
    ['an unknown view', 'view=mine', { view: 'assigned' }],
    ['an unknown status', 'status=open', { status: undefined }],
    ['an id that is not one', 'priority=7', { priorityId: undefined }],
    ['a page that is not a positive integer', 'page=-2', { page: 1 }],
    ['a fractional page', 'page=1.5', { page: 1 }],
    ['an unknown sort', 'sort=color&dir=up', { sort: 'lastActivity', direction: 'desc' }],
    ['a sort by the field without a field filter', 'sort=field&dir=asc', { sort: 'lastActivity', direction: 'asc' }],
    ['a page that is not a number', 'page=two', { page: 1 }],
  ])('ignores %s', (_, query, expected) => {
    expect(read(query)).toMatchObject(expected);
  });
});

describe('writeInboxParams', () => {
  it('leaves the defaults out', () => {
    expect(writeInboxParams(defaults).toString()).toBe('');
  });

  it('round-trips what differs from the defaults', () => {
    const params = { ...defaults, view: 'all', status: 'CLOSED', search: 'PAG-12', searchMessages: true, categoryId: CATEGORY, page: 2 } as const;
    expect(readInboxParams(writeInboxParams(params))).toEqual(params);
  });

  it('keeps an order other than the latest activity first', () => {
    const params = { ...defaults, sort: 'workflowPriority', direction: 'asc' } as const;
    expect(writeInboxParams(params).toString()).toBe('sort=workflowPriority&dir=asc');
    expect(readInboxParams(writeInboxParams(params))).toEqual(params);
  });
});

describe('filterQuery', () => {
  it('names the filters as the API does, only those set', () => {
    expect(filterQuery({ ...NO_FILTERS, search: 'ana', priorityId: PRIORITY }).toString()).toBe(`search=ana&priorityId=${PRIORITY}`);
  });

  it('asks to look in the messages only with something to search', () => {
    expect(filterQuery({ ...NO_FILTERS, search: 'tóner', searchMessages: true }).toString()).toBe('search=t%C3%B3ner&searchMessages=true');
    expect(filterQuery({ ...NO_FILTERS, searchMessages: true }).toString()).toBe('');
  });
});

describe('the field filter', () => {
  const NOW = new Date(2026, 9, 22, 18, 0);
  const field = (fieldOperator: FieldOperator, fieldValue?: string, fieldValueTo?: string) => ({ ...NO_FILTERS, fieldCode: 'DUE_ON', fieldOperator, fieldValue, fieldValueTo });

  it('reads the code, the condition and the values from the URL, and drops a code that is not one', () => {
    expect(read('field=DUE_ON&op=between&fv=2026-01-01&fv2=%202026-01-31%20')).toMatchObject({ fieldCode: 'DUE_ON', fieldOperator: 'between', fieldValue: '2026-01-01', fieldValueTo: '2026-01-31' });
    expect(read('field=due&op=filled&fv=x')).toMatchObject({ fieldCode: undefined, fieldOperator: undefined, fieldValue: undefined });
    expect(read('field=DUE_ON&op=sometime')).toMatchObject({ fieldCode: 'DUE_ON', fieldOperator: undefined });
  });

  it('round-trips through the URL', () => {
    const params = { ...defaults, ...field('upcoming', '15') };
    expect(read(writeInboxParams(params).toString())).toEqual(params);
  });

  it('sends only a whole filter to the API', () => {
    expect(apiFieldFilter(field('contains', 'fac'), NOW)).toEqual({ fieldCode: 'DUE_ON', fieldOperator: 'contains', fieldValue: 'fac' });
    expect(apiFieldFilter(field('contains'), NOW)).toBeUndefined();
    expect(apiFieldFilter(field('between', 'a'), NOW)).toBeUndefined();
    expect(apiFieldFilter(field('between', undefined, '10'), NOW)).toEqual({ fieldCode: 'DUE_ON', fieldOperator: 'between', fieldValue: undefined, fieldValueTo: '10' });
    expect(apiFieldFilter(field('filled', 'x'), NOW)).toEqual({ fieldCode: 'DUE_ON', fieldOperator: 'filled' });
    expect(apiFieldFilter({ ...NO_FILTERS, fieldCode: 'DUE_ON' }, NOW)).toBeUndefined();
  });

  it('turns overdue and upcoming into ranges of the person\'s own days', () => {
    expect(apiFieldFilter(field('overdue'), NOW)).toEqual({ fieldCode: 'DUE_ON', fieldOperator: 'between', fieldValueTo: '2026-10-21' });
    expect(apiFieldFilter(field('upcoming', '10'), NOW)).toEqual({ fieldCode: 'DUE_ON', fieldOperator: 'between', fieldValue: '2026-10-22', fieldValueTo: '2026-11-01' });
    expect(apiFieldFilter(field('upcoming', '-1'), NOW)).toBeUndefined();
    expect(apiFieldFilter(field('upcoming', '2.5'), NOW)).toBeUndefined();
  });

  it('goes in the API query with the other filters', () => {
    expect(filterQuery(field('equals', '77')).toString()).toBe('fieldCode=DUE_ON&fieldOperator=equals&fieldValue=77');
  });
});
