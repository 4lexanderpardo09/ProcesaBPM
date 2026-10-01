import { describe, expect, it } from 'vitest';
import { pickRoundRobin } from './round-robin.js';

describe('pickRoundRobin', () => {
  const ids = ['u3', 'u1', 'u2'];
  it('starts with the lowest id', () => expect(pickRoundRobin(ids, null)).toBe('u1'));
  it('goes on with the next one and wraps around', () => {
    expect(pickRoundRobin(ids, 'u1')).toBe('u2');
    expect(pickRoundRobin(ids, 'u3')).toBe('u1');
  });
  it('works when the last person is no longer a candidate', () => {
    expect(pickRoundRobin(['u1', 'u3'], 'u2')).toBe('u3');
    expect(pickRoundRobin(['u1', 'u2'], 'zzz')).toBe('u1');
  });
  it('a single candidate always gets it', () => expect(pickRoundRobin(['u1'], 'u1')).toBe('u1'));
  it('ignores repeats', () => expect(pickRoundRobin(['u2', 'u2', 'u1'], 'u1')).toBe('u2'));
});
