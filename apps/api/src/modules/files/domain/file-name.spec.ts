import { describe, expect, it } from 'vitest';
import { sanitizeFileName } from './file-name.js';
import { buildStorageKey } from './storage-key.js';

describe('sanitizeFileName', () => {
  it('composes accents and drops control characters', () => {
    expect(sanitizeFileName('  informe\u0000 año.pdf\n')).toBe('informe año.pdf');
  });
});

describe('buildStorageKey', () => {
  it('uses the tenant, the UTC year and month and the file id', () => {
    expect(buildStorageKey('t1', 'f1', new Date('2026-12-31T23:59:59Z'))).toBe('tenants/t1/2026/12/f1');
    expect(buildStorageKey('t1', 'f1', new Date('2027-01-01T00:00:00Z'))).toBe('tenants/t1/2027/01/f1');
  });
});
