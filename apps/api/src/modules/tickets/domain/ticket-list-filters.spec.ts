import { describe, expect, it } from 'vitest';
import { fieldFilter, searchFilter, ticketFilters, ticketNumberOf, viewFilter } from './ticket-list-filters.js';
import { createdBy, observedBy } from './ticket-subject.js';

const ID = '0199a000-0000-7000-8000-000000000001';
const ME = '0199a000-0000-7000-8000-000000000002';
const caller = { userId: '0199a000-0000-7000-8000-000000000002', membership: { departmentId: null, siteId: null, positionId: null } };
const like = (text: string) => ({ contains: text, mode: 'insensitive' });

describe('ticketNumberOf', () => {
  it.each([
    ['42', 42n],
    ['#42', 42n],
    ['007', 7n],
    ['999999999999999999', 999999999999999999n],
  ])('reads %s as a ticket number', (text, number) => {
    expect(ticketNumberOf(text)).toBe(number);
  });

  it.each(['T-42', '4 2', '42a', '#', '1234567890123456789', '-1'])('%s is not a ticket number', (text) => {
    expect(ticketNumberOf(text)).toBeUndefined();
  });
});

describe('searchFilter', () => {
  it('looks for the number, the title and the requester\'s name', () => {
    expect(searchFilter('#42')).toEqual({
      OR: [{ number: 42n }, { title: like('#42') }, { creator: { user: { AND: [{ OR: [{ firstName: like('#42') }, { lastName: like('#42') }] }] } } }],
    });
  });

  it('leaves the number out when the text is not one', () => {
    expect((searchFilter('printer').OR as unknown[]).length).toBe(2);
  });

  it('asks for every word of the name in the first or the last name', () => {
    const [, requester] = searchFilter('ana  pérez').OR as unknown[];
    expect(requester).toEqual({
      creator: { user: { AND: [{ OR: [{ firstName: like('ana') }, { lastName: like('ana') }] }, { OR: [{ firstName: like('pérez') }, { lastName: like('pérez') }] }] } },
    });
  });

  it('escapes the LIKE wildcards so they match literally', () => {
    const [title] = searchFilter('100%_\\').OR as unknown[];
    expect(title).toEqual({ title: like('100\\%\\_\\\\') });
  });
});

describe('ticketFilters', () => {
  it('is empty without filters', () => {
    expect(ticketFilters({}, ME)).toEqual([]);
  });

  it('turns every filter into its own term', () => {
    expect(ticketFilters({ status: 'OPEN', priorityId: ID, companyId: ID, categoryId: ID, search: 'x' }, ME)).toEqual([
      { status: 'OPEN' },
      { priorityId: ID },
      { companyId: ID },
      { subcategory: { categoryId: ID } },
      searchFilter('x'),
    ]);
  });

  it('narrows by subcategory, site, requester, current holder, own tag and creation dates (the end excluded)', () => {
    const from = '2026-10-01T05:00:00.000Z';
    const to = '2026-11-01T05:00:00.000Z';
    expect(ticketFilters({ subcategoryId: ID, siteId: ID, creatorId: ID, assigneeId: ID, tagId: ID, createdFrom: from, createdTo: to }, ME)).toEqual([
      { subcategoryId: ID },
      { siteId: ID },
      { creatorId: ID },
      { assignees: { some: { userId: ID } } },
      { tags: { some: { tagId: ID, userId: ME } } },
      { createdAt: { gte: new Date(from) } },
      { createdAt: { lt: new Date(to) } },
    ]);
  });
});

describe('fieldFilter', () => {
  const code = 'DUE_ON';
  const withValue = (value: unknown) => ({ fieldValues: { some: { field: { code }, value } } });

  it('contains: the text anywhere, ignoring case', () => {
    expect(fieldFilter({ code, operator: 'contains', value: 'fac' })).toEqual(withValue({ path: [], string_contains: 'fac', mode: 'insensitive' }));
  });

  it('equals: the text, or the number it reads as', () => {
    expect(fieldFilter({ code, operator: 'equals', value: '77' })).toEqual({ OR: [withValue({ equals: '77' }), withValue({ equals: 77 })] });
    expect(fieldFilter({ code, operator: 'equals', value: 'abc' })).toEqual({ OR: [withValue({ equals: 'abc' })] });
  });

  it('between dates: both ends are strings, the last day included', () => {
    expect(fieldFilter({ code, operator: 'between', value: '2026-03-01', valueTo: '2026-03-31' })).toEqual(withValue({ gte: '2026-03-01', lt: '2026-04-01' }));
    expect(fieldFilter({ code, operator: 'between', valueTo: '2026-12-31' })).toEqual(withValue({ gte: '0000-01-01', lt: '2027-01-01' }));
    expect(fieldFilter({ code, operator: 'between', value: '2026-03-01' })).toEqual(withValue({ gte: '2026-03-01', lt: '9999-12-31' }));
  });

  it('between numbers: both ends are numbers', () => {
    expect(fieldFilter({ code, operator: 'between', value: '10', valueTo: '20.5' })).toEqual(withValue({ gte: 10, lte: 20.5 }));
    expect(fieldFilter({ code, operator: 'between', valueTo: '20' })).toEqual(withValue({ gte: -1e18, lte: 20 }));
  });

  it('filled or empty: whether the ticket has a value for that code', () => {
    expect(fieldFilter({ code, operator: 'filled' })).toEqual({ fieldValues: { some: { field: { code } } } });
    expect(fieldFilter({ code, operator: 'empty' })).toEqual({ fieldValues: { none: { field: { code } } } });
  });

  it('is one more term of the inbox filters', () => {
    expect(ticketFilters({ fieldCode: code, fieldOperator: 'filled' }, ME)).toEqual([{ fieldValues: { some: { field: { code } } } }]);
  });
});

describe('viewFilter', () => {
  it('created: what the caller created or registered', () => {
    expect(viewFilter('created', caller)).toEqual(createdBy(caller.userId));
  });

  it('assigned: the current assignments only', () => {
    expect(viewFilter('assigned', caller)).toEqual({ assignees: { some: { userId: caller.userId } } });
  });

  it('observed: the workflows the caller observes', () => {
    expect(viewFilter('observed', caller)).toEqual(observedBy(caller));
  });

  it('all: no restriction of its own (the access filter still applies)', () => {
    expect(viewFilter('all', caller)).toEqual({});
  });
});
