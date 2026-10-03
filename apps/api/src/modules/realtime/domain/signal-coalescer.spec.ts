import { describe, expect, it } from 'vitest';
import { SignalCoalescer } from './signal-coalescer.js';

interface Change {
  readonly id: string;
  readonly kinds: ReadonlySet<string>;
}

const union = (a: Change, b: Change): Change => ({ id: a.id, kinds: new Set([...a.kinds, ...b.kinds]) });

describe('SignalCoalescer', () => {
  it('merges values of the same key and keeps the arrival order of the keys', () => {
    const coalescer = new SignalCoalescer<Change>(union);
    coalescer.add('a', { id: 'a', kinds: new Set(['created']) });
    coalescer.add('b', { id: 'b', kinds: new Set(['assigned']) });
    coalescer.add('a', { id: 'a', kinds: new Set(['transitioned', 'created']) });
    const drained = coalescer.drain();
    expect(drained.map((change) => [change.id, [...change.kinds].sort()])).toEqual([
      ['a', ['created', 'transitioned']],
      ['b', ['assigned']],
    ]);
  });

  it('is empty after a drain', () => {
    const coalescer = new SignalCoalescer<Change>(union);
    coalescer.add('a', { id: 'a', kinds: new Set(['x']) });
    coalescer.drain();
    expect(coalescer.size).toBe(0);
    expect(coalescer.drain()).toEqual([]);
  });
});
