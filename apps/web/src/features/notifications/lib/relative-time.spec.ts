import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const now = new Date('2026-10-21T15:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('formatRelativeTime', () => {
  it('says now for the last minute and for a time ahead of the clock', () => {
    expect(formatRelativeTime(ago(20_000), now)).toBe('ahora');
    expect(formatRelativeTime(ago(-90_000), now)).toBe('ahora');
  });
  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('hace 5 minutos');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('hace 3 horas');
    expect(formatRelativeTime(ago(26 * 3_600_000), now)).toBe('ayer');
    expect(formatRelativeTime(ago(3 * 86_400_000), now)).toBe('hace 3 días');
  });
  it('gives the date after a week, in the profile time zone', () => {
    expect(formatRelativeTime('2026-10-01T03:00:00Z', now, 'America/Bogota')).toBe('30 de sept de 2026');
  });
  it('leaves an unreadable value as it came', () => {
    expect(formatRelativeTime('nope', now)).toBe('nope');
  });
});
