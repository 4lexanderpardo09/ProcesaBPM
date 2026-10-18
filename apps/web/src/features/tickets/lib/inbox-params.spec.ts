import { describe, expect, it } from 'vitest';
import { readInboxParams, writeInboxParams } from './inbox-params';

const read = (query: string) => readInboxParams(new URLSearchParams(query));

describe('readInboxParams', () => {
  it('opens on the assigned tickets, any status, first page', () => {
    expect(read('')).toEqual({ view: 'assigned', status: undefined, page: 1 });
  });

  it('reads the view, the status and the page', () => {
    expect(read('view=observed&status=PAUSED&page=3')).toEqual({ view: 'observed', status: 'PAUSED', page: 3 });
  });

  it.each([
    ['an unknown view', 'view=mine', { view: 'assigned' }],
    ['an unknown status', 'status=open', { status: undefined }],
    ['a page that is not a positive integer', 'page=-2', { page: 1 }],
    ['a fractional page', 'page=1.5', { page: 1 }],
    ['a page that is not a number', 'page=two', { page: 1 }],
  ])('ignores %s', (_, query, expected) => {
    expect(read(query)).toMatchObject(expected);
  });
});

describe('writeInboxParams', () => {
  it('leaves the defaults out', () => {
    expect(writeInboxParams({ view: 'assigned', status: undefined, page: 1 }).toString()).toBe('');
  });

  it('round-trips what differs from the defaults', () => {
    const params = { view: 'all', status: 'CLOSED', page: 2 } as const;
    expect(readInboxParams(writeInboxParams(params))).toEqual(params);
  });
});
