import { describe, expect, it } from 'vitest';
import { attachmentIdsSchema, requestUploadsSchema } from './schemas.js';

const SHA = 'f'.repeat(64);
const file = (overrides: Record<string, unknown> = {}) => ({ name: 'contract.pdf', sizeBytes: 1000, sha256: SHA, ...overrides });

describe('requestUploadsSchema', () => {
  it('accepts a valid declaration', () => {
    expect(requestUploadsSchema.safeParse({ files: [file()] }).success).toBe(true);
  });
  it.each([
    ['no files', { files: [] }],
    ['16 files', { files: Array.from({ length: 16 }, () => file()) }],
    ['a file over 4 MB', { files: [file({ sizeBytes: 4 * 1024 * 1024 + 1 })] }],
    ['an empty file', { files: [file({ sizeBytes: 0 })] }],
    ['an SVG', { files: [file({ name: 'logo.svg' })] }],
    ['a name with a path', { files: [file({ name: '../etc/passwd.pdf' })] }],
    ['a name with a control character', { files: [file({ name: 'a\u0000.pdf' })] }],
    ['a bad hash', { files: [file({ sha256: 'xyz' })] }],
    ['an uppercase hash', { files: [file({ sha256: 'F'.repeat(64) })] }],
  ])('rejects %s', (_label, body) => {
    expect(requestUploadsSchema.safeParse(body).success).toBe(false);
  });
  it('rejects more than 20 MB in total, even when each file fits', () => {
    const files = Array.from({ length: 5 }, () => file({ sizeBytes: 4 * 1024 * 1024 }));
    expect(requestUploadsSchema.safeParse({ files }).success).toBe(true);
    expect(requestUploadsSchema.safeParse({ files: [...files, file({ sizeBytes: 1 })] }).success).toBe(false);
  });
});

describe('attachmentIdsSchema', () => {
  const id = '0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90';
  it('defaults to none and rejects repeats and more than 15', () => {
    expect(attachmentIdsSchema.parse(undefined)).toEqual([]);
    expect(attachmentIdsSchema.safeParse([id, id]).success).toBe(false);
    expect(attachmentIdsSchema.safeParse(Array.from({ length: 16 }, (_v, i) => `0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f${(10 + i).toString(16).padStart(2, '0')}`)).success).toBe(false);
  });
});
