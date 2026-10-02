import { describe, expect, it } from 'vitest';
import { deriveGeneratedFileId } from './derive-file-id.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const EVENT = '0199a000-0000-7000-8000-000000000002';

describe('deriveGeneratedFileId', () => {
  it('is deterministic: the same event always gives the same id', () => {
    expect(deriveGeneratedFileId(TENANT, EVENT)).toBe(deriveGeneratedFileId(TENANT, EVENT));
  });

  it('differs by event and by tenant', () => {
    expect(deriveGeneratedFileId(TENANT, EVENT)).not.toBe(deriveGeneratedFileId(TENANT, '0199a000-0000-7000-8000-000000000003'));
    expect(deriveGeneratedFileId(TENANT, EVENT)).not.toBe(deriveGeneratedFileId('0199a000-0000-7000-8000-000000000009', EVENT));
  });

  it('is a version 8 UUID with the RFC variant', () => {
    expect(deriveGeneratedFileId(TENANT, EVENT)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
