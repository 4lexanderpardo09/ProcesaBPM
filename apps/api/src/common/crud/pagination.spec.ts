import { describe, expect, it } from 'vitest';
import { nameFilter, pageWindow, toPage } from './pagination.js';

const query = { page: 3, pageSize: 10, includeInactive: false };

describe('pagination helpers', () => {
  it('skips the previous pages', () => {
    expect(pageWindow(query)).toEqual({ skip: 20, take: 10 });
  });

  it('hides inactive records unless asked and searches the name without case', () => {
    expect(nameFilter(query)).toEqual({ isActive: true });
    expect(nameFilter({ ...query, includeInactive: true, search: 'ab' })).toEqual({ name: { contains: 'ab', mode: 'insensitive' } });
  });

  it('maps the rows and keeps the paging data', () => {
    expect(toPage([1, 2], 12, query, (n) => n * 2)).toEqual({ items: [2, 4], page: 3, pageSize: 10, total: 12 });
  });
});
