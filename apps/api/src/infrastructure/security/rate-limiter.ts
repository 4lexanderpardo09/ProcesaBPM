import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../clock.js';

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/** Counts hits per key; the in-memory version below can be replaced by a Redis one. */
export interface RateLimiter {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

export const RATE_LIMITER = Symbol('RATE_LIMITER');

const PURGE_EVERY_HITS = 1_000;
/** Bounds the memory: beyond it the oldest windows are dropped first. */
export const MAX_TRACKED_KEYS = 100_000;

interface Window {
  count: number;
  resetsAt: number;
}

/** Fixed-window counters kept in the process memory: enough for one instance, not shared between several. */
@Injectable()
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private hits = 0;

  constructor(@Inject(Clock) private readonly clock: Clock) {}

  hit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    this.purgeExpired(now);
    const current = this.windows.get(key);
    const window = current !== undefined && current.resetsAt > now ? current : { count: 0, resetsAt: now + rule.windowMs };
    window.count += 1;
    this.windows.delete(key);
    this.windows.set(key, window);
    this.evictOldest();
    const allowed = window.count <= rule.limit;
    return Promise.resolve({ allowed, retryAfterSeconds: allowed ? 0 : Math.ceil((window.resetsAt - now) / 1000) });
  }

  private evictOldest(): void {
    for (const key of this.windows.keys()) {
      if (this.windows.size <= MAX_TRACKED_KEYS) return;
      this.windows.delete(key);
    }
  }

  private purgeExpired(now: number): void {
    this.hits += 1;
    if (this.hits % PURGE_EVERY_HITS !== 0) return;
    for (const [key, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(key);
    }
  }
}
