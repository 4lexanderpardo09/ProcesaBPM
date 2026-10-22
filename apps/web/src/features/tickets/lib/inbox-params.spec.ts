import { describe, expect, it } from 'vitest';
import { filterQuery, NO_FILTERS, readInboxParams, writeInboxParams } from './inbox-params';

const read = (query: string) => readInboxParams(new URLSearchParams(query));
const PRIORITY = '018f0000-0000-7000-8000-000000000001';
const CATEGORY = '018f0000-0000-7000-8000-000000000002';
const COMPANY = '018f0000-0000-7000-8000-000000000003';
const defaults = { view: 'assigned', page: 1, ...NO_FILTERS } as const;

describe('readInboxParams', () => {
  it('opens on the assigned tickets, no filters, first page', () => {
    expect(read('')).toEqual(defaults);
  });

  it('reads the view, the filters and the page', () => {
    expect(read(`view=observed&status=PAUSED&q=%20cuenta%20&priority=${PRIORITY}&category=${CATEGORY}&company=${COMPANY}&page=3`)).toEqual({
      view: 'observed',
      status: 'PAUSED',
      search: 'cuenta',
      priorityId: PRIORITY,
      categoryId: CATEGORY,
      companyId: COMPANY,
      page: 3,
    });
  });

  it.each([
    ['an unknown view', 'view=mine', { view: 'assigned' }],
    ['an unknown status', 'status=open', { status: undefined }],
    ['an id that is not one', 'priority=7', { priorityId: undefined }],
    ['a page that is not a positive integer', 'page=-2', { page: 1 }],
    ['a fractional page', 'page=1.5', { page: 1 }],
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
    const params = { ...defaults, view: 'all', status: 'CLOSED', search: 'PAG-12', categoryId: CATEGORY, page: 2 } as const;
    expect(readInboxParams(writeInboxParams(params))).toEqual(params);
  });
});

describe('filterQuery', () => {
  it('names the filters as the API does, only those set', () => {
    expect(filterQuery({ ...NO_FILTERS, search: 'ana', priorityId: PRIORITY }).toString()).toBe(`search=ana&priorityId=${PRIORITY}`);
  });
});
