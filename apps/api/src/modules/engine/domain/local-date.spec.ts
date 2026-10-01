import { describe, expect, it } from 'vitest';
import { localDateIn } from './local-date.js';

describe('localDateIn', () => {
  it('uses the calendar day of the zone, not of UTC', () => {
    const instant = new Date('2026-10-06T03:00:00Z');
    expect(localDateIn('America/Bogota', instant)).toBe('2026-10-05');
    expect(localDateIn('UTC', instant)).toBe('2026-10-06');
  });
});
