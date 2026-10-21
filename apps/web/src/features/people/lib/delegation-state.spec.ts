import { describe, expect, it } from 'vitest';
import { delegationState } from './delegation-state';

const now = new Date('2026-10-21T15:00:00Z');

describe('delegationState', () => {
  it('tells a delegation to come, one in force and one over', () => {
    expect(delegationState({ startsAt: '2026-10-22T00:00:00Z', endsAt: '2026-10-25T00:00:00Z' }, now)).toBe('scheduled');
    expect(delegationState({ startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-10-25T00:00:00Z' }, now)).toBe('active');
    expect(delegationState({ startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-25T00:00:00Z' }, now)).toBe('active');
    expect(delegationState({ startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-21T15:00:00Z' }, now)).toBe('ended');
  });
});
