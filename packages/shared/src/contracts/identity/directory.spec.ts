import { describe, expect, it } from 'vitest';
import { memberDirectoryQuerySchema } from './schemas.js';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;

describe('memberDirectoryQuerySchema', () => {
  it('takes a search of two letters or more, or a list of ids', () => {
    expect(memberDirectoryQuerySchema.parse({ search: ' an ' })).toEqual({ search: 'an' });
    expect(memberDirectoryQuerySchema.parse({ ids: `${id(1)},${id(2)}` })).toEqual({ ids: [id(1), id(2)] });
  });

  it('refuses both, neither, a one-letter search, a bad id and too many ids', () => {
    expect(memberDirectoryQuerySchema.safeParse({ search: 'ana', ids: id(1) }).success).toBe(false);
    expect(memberDirectoryQuerySchema.safeParse({}).success).toBe(false);
    expect(memberDirectoryQuerySchema.safeParse({ search: 'a' }).success).toBe(false);
    expect(memberDirectoryQuerySchema.safeParse({ ids: 'x' }).success).toBe(false);
    expect(memberDirectoryQuerySchema.safeParse({ ids: Array.from({ length: 21 }, (_, index) => id(index)).join(',') }).success).toBe(false);
  });
});
