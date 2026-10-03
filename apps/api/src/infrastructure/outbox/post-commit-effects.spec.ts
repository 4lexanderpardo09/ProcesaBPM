import { describe, expect, it, vi } from 'vitest';
import { PostCommitEffects } from './post-commit-effects.js';

describe('PostCommitEffects', () => {
  it('runs nothing until asked, then every effect in order', async () => {
    const effects = new PostCommitEffects();
    const calls: number[] = [];
    effects.afterCommit(() => Promise.resolve(void calls.push(1)));
    effects.afterCommit(() => Promise.resolve(void calls.push(2)));
    expect(calls).toEqual([]);
    await effects.run(() => undefined);
    expect(calls).toEqual([1, 2]);
  });

  it('reports a failing effect and still runs the rest', async () => {
    const effects = new PostCommitEffects();
    const onError = vi.fn();
    const after = vi.fn().mockResolvedValue(undefined);
    effects.afterCommit(() => Promise.reject(new Error('queue full')));
    effects.afterCommit(after);
    await expect(effects.run(onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});
