import { describe, expect, it } from 'vitest';
import type { Clock } from '../../../infrastructure/clock.js';
import type { RawPermissionRule } from '../domain/build-ability.js';
import { ABILITY_CACHE_MAX_ENTRIES, ABILITY_CACHE_TTL_MS, InMemoryAbilityCache } from './ability-cache.js';

const rules = (action: string): RawPermissionRule[] => [{ action, subject: 'Company', conditions: null }];

function setup() {
  let now = 0;
  const clock: Clock = { now: () => new Date(now) };
  return { cache: new InMemoryAbilityCache(clock), advance: (ms: number) => (now += ms) };
}

describe('InMemoryAbilityCache', () => {
  it('returns what was stored for the same tenant, role and version', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', 1, rules('read'));
    expect(await cache.get('t1', 'r1', 1)).toEqual(rules('read'));
  });

  it('an entry of version 1 is a miss for version 2 (a permission change is seen at once, with no invalidation)', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', 1, rules('read'));
    expect(await cache.get('t1', 'r1', 2)).toBeUndefined();
    await cache.set('t1', 'r1', 2, rules('update'));
    expect(await cache.get('t1', 'r1', 2)).toEqual(rules('update'));
    expect(await cache.get('t1', 'r1', 1)).toBeUndefined();
  });

  it('a slower request with an older version does not replace the newer entry', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', 5, rules('new'));
    await cache.set('t1', 'r1', 4, rules('old'));
    expect(await cache.get('t1', 'r1', 5)).toEqual(rules('new'));
    expect(await cache.get('t1', 'r1', 4)).toBeUndefined();
  });

  it('keeps tenants and roles apart, also when the role id and the version are the same', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', 1, rules('read'));
    await cache.set('t2', 'r1', 1, rules('update'));
    expect(await cache.get('t1', 'r1', 1)).toEqual(rules('read'));
    expect(await cache.get('t2', 'r1', 1)).toEqual(rules('update'));
    expect(await cache.get('t1', 'r2', 1)).toBeUndefined();
  });

  it('forgets an entry after the time to live (it only bounds memory)', async () => {
    const { cache, advance } = setup();
    await cache.set('t1', 'r1', 1, rules('read'));
    advance(ABILITY_CACHE_TTL_MS - 1);
    expect(await cache.get('t1', 'r1', 1)).toBeDefined();
    advance(2);
    expect(await cache.get('t1', 'r1', 1)).toBeUndefined();
  });

  it('never keeps more than the maximum, dropping the least recently used', async () => {
    const { cache } = setup();
    for (let i = 0; i < ABILITY_CACHE_MAX_ENTRIES; i += 1) await cache.set('t', `r${i}`, 1, rules('read'));
    await cache.get('t', 'r0', 1); // r0 becomes the most recently used
    await cache.set('t', 'extra', 1, rules('read'));
    expect(await cache.get('t', 'r0', 1)).toBeDefined();
    expect(await cache.get('t', 'r1', 1)).toBeUndefined();
    expect(await cache.get('t', 'extra', 1)).toBeDefined();
  });
});
