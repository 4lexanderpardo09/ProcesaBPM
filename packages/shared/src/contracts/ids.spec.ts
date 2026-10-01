import { describe, expect, it } from 'vitest';
import { isUuid, uuidSchema } from './ids.js';

describe('UUIDs', () => {
  it.each([
    ['a UUIDv4', '8f14e45f-ceea-467a-9575-1c2a8f0e5d3b', true],
    ['a UUIDv7', '018f3c1e-7b2a-7c3d-9e4f-0123456789ab', true],
    ['uppercase', '018F3C1E-7B2A-7C3D-9E4F-0123456789AB', true],
    ['the nil UUID', '00000000-0000-0000-0000-000000000000', false],
    ['the max UUID', 'ffffffff-ffff-ffff-ffff-ffffffffffff', false],
    ['without dashes', '018f3c1e7b2a7c3d9e4f0123456789ab', false],
    ['with spaces', ' 018f3c1e-7b2a-7c3d-9e4f-0123456789ab', false],
    ['not a UUID', 'acme', false],
  ])('%s', (_label, value, valid) => {
    expect(isUuid(value)).toBe(valid);
    expect(uuidSchema.safeParse(value).success).toBe(valid);
  });

  it('isUuid rejects non-strings', () => {
    expect(isUuid(42)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
