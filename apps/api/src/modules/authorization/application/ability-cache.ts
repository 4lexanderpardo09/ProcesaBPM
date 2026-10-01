import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../infrastructure/clock.js';
import type { RawPermissionRule } from '../domain/build-ability.js';

/**
 * Cache of the raw (not yet resolved) rules of a role. Rules are plain data, so a Redis version can
 * implement this interface. Resolved abilities depend on the member and are never cached here.
 */
export interface AbilityCache {
  get(tenantId: string, roleId: string): Promise<readonly RawPermissionRule[] | undefined>;
  set(tenantId: string, roleId: string, rules: readonly RawPermissionRule[]): Promise<void>;
  /** Call when the permissions of a role change. */
  invalidateRole(tenantId: string, roleId: string): Promise<void>;
  invalidateTenant(tenantId: string): Promise<void>;
}

export const ABILITY_CACHE = Symbol('ABILITY_CACHE');

/** How long a role's rules may be served without asking the database again. */
export const ABILITY_CACHE_TTL_MS = 30_000;
export const ABILITY_CACHE_MAX_ENTRIES = 1_000;

interface Entry {
  readonly rules: readonly RawPermissionRule[];
  readonly expiresAt: number;
}

/**
 * In-memory, per process: a change made on another instance is seen when its entry expires
 * (at most `ABILITY_CACHE_TTL_MS`); the instance that made the change invalidates at once.
 */
@Injectable()
export class InMemoryAbilityCache implements AbilityCache {
  private readonly entries = new Map<string, Entry>();

  constructor(@Inject(Clock) private readonly clock: Clock) {}

  get(tenantId: string, roleId: string): Promise<readonly RawPermissionRule[] | undefined> {
    const key = this.keyOf(tenantId, roleId);
    const entry = this.entries.get(key);
    if (entry === undefined) return Promise.resolve(undefined);
    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    // Move to the end: the least recently used entries are evicted first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return Promise.resolve(entry.rules);
  }

  set(tenantId: string, roleId: string, rules: readonly RawPermissionRule[]): Promise<void> {
    const key = this.keyOf(tenantId, roleId);
    this.entries.delete(key);
    this.entries.set(key, { rules, expiresAt: this.clock.now().getTime() + ABILITY_CACHE_TTL_MS });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= ABILITY_CACHE_MAX_ENTRIES) break;
      this.entries.delete(oldest);
    }
    return Promise.resolve();
  }

  invalidateRole(tenantId: string, roleId: string): Promise<void> {
    this.entries.delete(this.keyOf(tenantId, roleId));
    return Promise.resolve();
  }

  invalidateTenant(tenantId: string): Promise<void> {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${tenantId}:`)) this.entries.delete(key);
    }
    return Promise.resolve();
  }

  private keyOf(tenantId: string, roleId: string): string {
    return `${tenantId}:${roleId}`;
  }
}
