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
  it('returns what was stored for the same tenant and role', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', rules('read'));
    expect(await cache.get('t1', 'r1')).toEqual(rules('read'));
  });

  it('keeps tenants and roles apart, also when the role id is the same', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', rules('read'));
    await cache.set('t2', 'r1', rules('update'));
    expect(await cache.get('t1', 'r1')).toEqual(rules('read'));
    expect(await cache.get('t2', 'r1')).toEqual(rules('update'));
    expect(await cache.get('t1', 'r2')).toBeUndefined();
  });

  it('forgets an entry after the time to live', async () => {
    const { cache, advance } = setup();
    await cache.set('t1', 'r1', rules('read'));
    advance(ABILITY_CACHE_TTL_MS - 1);
    expect(await cache.get('t1', 'r1')).toBeDefined();
    advance(2);
    expect(await cache.get('t1', 'r1')).toBeUndefined();
  });

  it('a permission change invalidates the role, and only that role', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', rules('read'));
    await cache.set('t1', 'r2', rules('update'));
    await cache.invalidateRole('t1', 'r1');
    expect(await cache.get('t1', 'r1')).toBeUndefined();
    expect(await cache.get('t1', 'r2')).toBeDefined();
  });

  it('invalidating a tenant drops all its roles and no other tenant', async () => {
    const { cache } = setup();
    await cache.set('t1', 'r1', rules('read'));
    await cache.set('t1', 'r2', rules('read'));
    await cache.set('t10', 'r1', rules('read'));
    await cache.invalidateTenant('t1');
    expect(await cache.get('t1', 'r1')).toBeUndefined();
    expect(await cache.get('t1', 'r2')).toBeUndefined();
    expect(await cache.get('t10', 'r1')).toBeDefined();
  });

  it('never keeps more than the maximum, dropping the least recently used', async () => {
    const { cache } = setup();
    for (let i = 0; i < ABILITY_CACHE_MAX_ENTRIES; i += 1) await cache.set('t', `r${i}`, rules('read'));
    await cache.get('t', 'r0'); // r0 becomes the most recently used
    await cache.set('t', 'extra', rules('read'));
    expect(await cache.get('t', 'r0')).toBeDefined();
    expect(await cache.get('t', 'r1')).toBeUndefined();
    expect(await cache.get('t', 'extra')).toBeDefined();
  });
});
