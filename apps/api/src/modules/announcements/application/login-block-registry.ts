import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { LoginBlockRepository } from '../data/login-block.repository.js';
import type { AnnouncementResponse } from '@procesabpm/shared';
import { blockFor, type BlockScope, type LoginBlock, publicNoticesOf } from '../domain/login-block-policy.js';

/** How long a snapshot is used before it is read again. Other instances see a change within this time. */
export const LOGIN_BLOCKS_TTL_MS = 30_000;
/** The most rows `auth_login_blocks()` returns (the ones for every organization first). */
export const LOGIN_BLOCKS_MAX = 200;

/**
 * The blocking announcements, kept in memory: one query per 30 s per instance when there is traffic, none per request.
 * The snapshot holds the announcements in force or starting within 24 hours, and each request evaluates it against the
 * clock, so a start or an end takes effect on time without a new query. The platform console calls `invalidate()` after
 * a change, so this instance sees it at once.
 *
 * A failed refresh keeps the last snapshot (fail open, logged): when the database cannot answer, every request fails
 * anyway, and a maintenance block must not turn a short outage into a total one.
 */
@Injectable()
export class LoginBlockRegistry {
  private snapshot: readonly LoginBlock[] = [];
  private refreshedAt: number | undefined;
  private pending: Promise<readonly LoginBlock[]> | undefined;
  /** Bumped by `invalidate()`: a refresh that started before it does not overwrite a newer snapshot. */
  private generation = 0;

  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(LoginBlockRepository) private readonly repository: LoginBlockRepository,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async blockFor(scope: BlockScope): Promise<LoginBlock | undefined> {
    const blocks = await this.current();
    return blockFor(blocks, this.clock.now(), scope);
  }

  /** The public sign-in banner, from the same snapshot: no query per call. */
  async publicNotices(): Promise<AnnouncementResponse[]> {
    const blocks = await this.current();
    return publicNoticesOf(blocks, this.clock.now());
  }

  invalidate(): void {
    this.generation += 1;
    this.refreshedAt = undefined;
    this.pending = undefined;
  }

  private current(): Promise<readonly LoginBlock[]> {
    if (this.isFresh(this.clock.now().getTime())) return Promise.resolve(this.snapshot);
    if (this.pending === undefined) {
      const pending = this.refresh(this.generation).finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
      this.pending = pending;
    }
    return this.pending;
  }

  private isFresh(now: number): boolean {
    return this.refreshedAt !== undefined && now >= this.refreshedAt && now - this.refreshedAt < LOGIN_BLOCKS_TTL_MS;
  }

  private async refresh(generation: number): Promise<readonly LoginBlock[]> {
    const startedAt = this.clock.now().getTime();
    let blocks = this.snapshot;
    try {
      blocks = await this.runner.withAnonymousTransaction((tx) => this.repository.list(tx));
      if (blocks.length >= LOGIN_BLOCKS_MAX) {
        this.logger.warn('Too many blocking announcements: only the first ones are applied', { event: 'announcements.login_blocks_truncated', max: LOGIN_BLOCKS_MAX });
      }
    } catch (error) {
      this.logger.warn('The login blocks could not be refreshed: the last snapshot stays in use', {
        event: 'announcements.login_blocks_refresh_failed',
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
    if (generation === this.generation) {
      this.snapshot = blocks;
      this.refreshedAt = startedAt;
    }
    return blocks;
  }
}
