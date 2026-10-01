import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../infrastructure/clock.js';
import type { RawPermissionRule } from '../domain/build-ability.js';

/**
 * Cache of the raw (not yet resolved) rules of a role. Rules are plain data, so a Redis version can
 * implement this interface. Resolved abilities depend on the member and are never cached here.
 *
 * An entry is valid only for the `permissionsVersion` of the role it was read with. The database
 * bumps that number on any change of the role's permissions and every request reads it, so a revoked
 * permission stops working on every instance at once, with nothing to invalidate.
 */
export interface AbilityCache {
  get(tenantId: string, roleId: string, version: number): Promise<readonly RawPermissionRule[] | undefined>;
  set(tenantId: string, roleId: string, version: number, rules: readonly RawPermissionRule[]): Promise<void>;
}

export const ABILITY_CACHE = Symbol('ABILITY_CACHE');

/** Bounds the memory only: entries of old versions are never read again. */
export const ABILITY_CACHE_TTL_MS = 5 * 60_000;
export const ABILITY_CACHE_MAX_ENTRIES = 1_000;

interface Entry {
  readonly version: number;
  readonly rules: readonly RawPermissionRule[];
  readonly expiresAt: number;
}

@Injectable()
export class InMemoryAbilityCache implements AbilityCache {
  private readonly entries = new Map<string, Entry>();

  constructor(@Inject(Clock) private readonly clock: Clock) {}

  get(tenantId: string, roleId: string, version: number): Promise<readonly RawPermissionRule[] | undefined> {
    const key = this.keyOf(tenantId, roleId);
    const entry = this.entries.get(key);
    if (entry === undefined) return Promise.resolve(undefined);
    if (entry.expiresAt <= this.clock.now().getTime() || entry.version !== version) {
      if (entry.version < version || entry.expiresAt <= this.clock.now().getTime()) this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    // Move to the end: the least recently used entries are evicted first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return Promise.resolve(entry.rules);
  }

  set(tenantId: string, roleId: string, version: number, rules: readonly RawPermissionRule[]): Promise<void> {
    const key = this.keyOf(tenantId, roleId);
    const current = this.entries.get(key);
    // A slower request must not replace the entry of a newer version.
    if (current !== undefined && current.version > version) return Promise.resolve();
    this.entries.delete(key);
    this.entries.set(key, { version, rules, expiresAt: this.clock.now().getTime() + ABILITY_CACHE_TTL_MS });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= ABILITY_CACHE_MAX_ENTRIES) break;
      this.entries.delete(oldest);
    }
    return Promise.resolve();
  }

  private keyOf(tenantId: string, roleId: string): string {
    return `${tenantId}:${roleId}`;
  }
}
