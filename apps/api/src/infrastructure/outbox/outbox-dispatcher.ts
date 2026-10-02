import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../common/logging/json-logger.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { Clock } from '../clock.js';
import type { CrossTenantTransaction, TenantTransaction } from '../database/transaction-scope.js';
import { WorkerTransactionRunner } from '../database/worker-transaction-runner.js';
import { type OutboxSource, OutboxClaimsRepository } from './outbox-claims.repository.js';
import { type ClaimedEvent, PermanentEventError, StaleClaimError } from './outbox-handler.js';
import { OutboxHandlerRegistry } from './outbox-handler.registry.js';
import { isLastAttempt, retryDelayMs } from './retry-policy.js';

export interface DispatchSummary {
  readonly claimed: number;
  readonly done: number;
  readonly retried: number;
  readonly failed: number;
  readonly stale: number;
  /** A batch came back full: there is probably more waiting. */
  readonly full: boolean;
}

type Outcome = 'done' | 'retried' | 'failed' | 'stale';

const EMPTY: DispatchSummary = { claimed: 0, done: 0, retried: 0, failed: 0, stale: 0, full: false };

/** Never carries payload data (addresses, tokens): only the kind of error. */
function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name}:${code}` : name;
}

const isPermanent = (error: unknown): boolean => error instanceof PermanentEventError || (error as { permanent?: unknown } | null)?.permanent === true;

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Claims the due events of both outboxes (platform first: those are security e-mails) and runs their handlers.
 * Every claim carries a lease; the handler's result is fenced by the attempt number, so a worker that lost its
 * lease can neither complete nor fail an event somebody else owns. Failures are retried with exponential
 * backoff until the last attempt, which is terminal (FAILED). Several workers can run at once.
 */
@Injectable()
export class OutboxDispatcher {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(OutboxClaimsRepository) private readonly claims: OutboxClaimsRepository,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
  ) {}

  async runOnce(): Promise<DispatchSummary> {
    const platform = await this.dispatch('platform');
    const tenant = await this.dispatch('tenant');
    return {
      claimed: platform.claimed + tenant.claimed,
      done: platform.done + tenant.done,
      retried: platform.retried + tenant.retried,
      failed: platform.failed + tenant.failed,
      stale: platform.stale + tenant.stale,
      full: platform.full || tenant.full,
    };
  }

  private async dispatch(source: OutboxSource): Promise<DispatchSummary> {
    const batch = this.settings.OUTBOX_BATCH_SIZE;
    const types = this.registry.tenantTypes();
    if (source === 'tenant' && types.length === 0) return EMPTY;
    const events = await this.runner.withoutTenant((tx) => (source === 'tenant' ? this.claims.claimTenant(tx, batch, types) : this.claims.claimPlatform(tx, batch)));
    const outcomes = await mapWithConcurrency(events, this.settings.OUTBOX_CONCURRENCY, (event) => this.process(source, event));
    const count = (outcome: Outcome) => outcomes.filter((candidate) => candidate === outcome).length;
    return { claimed: events.length, done: count('done'), retried: count('retried'), failed: count('failed'), stale: count('stale'), full: events.length >= batch };
  }

  private async process(source: OutboxSource, event: ClaimedEvent<unknown>): Promise<Outcome> {
    try {
      await this.execute(source, event);
      return 'done';
    } catch (error) {
      return this.recordFailure(source, event, error);
    }
  }

  private async execute(source: OutboxSource, event: ClaimedEvent<unknown>): Promise<void> {
    const timeoutMs = this.settings.OUTBOX_TX_TIMEOUT_MS;
    const transactional = source === 'tenant' ? this.registry.transactionalFor(event.type) : [];
    if (transactional.length > 0) {
      const handlers = transactional.map((handler) => ({ handler, event: { ...event, payload: parsePayload(handler.schema, event.payload) } }));
      await this.inScope(source, event, async (tx) => {
        // Transactional handlers exist for tenant events only, so this scope is always a tenant one.
        for (const { handler, event: parsed } of handlers) await handler.handle(tx as TenantTransaction, parsed as ClaimedEvent<never>);
        await this.completeOrThrow(tx, source, event);
      }, timeoutMs);
      return;
    }

    const external = this.registry.externalFor(source, event.type);
    if (external === undefined) throw new Error(`No handler for ${source} event type ${event.type}`);
    const parsed = { ...event, payload: parsePayload(external.schema, event.payload) } as ClaimedEvent<never>;
    const message = await this.inScope(source, event, async (tx) => {
      // A claim that outlived its lease belongs to another worker now: it, not this one, sends the e-mail.
      if (!(await this.claims.isCurrent(tx, source, event))) throw new StaleClaimError();
      return external.prepare(tx as never, parsed);
    }, timeoutMs);
    const result = message === null ? undefined : await external.perform(message as never, parsed);
    await this.inScope(source, event, async (tx) => {
      if (message !== null && external.record !== undefined) await external.record(tx as never, result as never, parsed);
      await this.completeOrThrow(tx, source, event);
    }, timeoutMs);
  }

  private async completeOrThrow(tx: TenantTransaction | CrossTenantTransaction, source: OutboxSource, event: ClaimedEvent<unknown>): Promise<void> {
    if (!(await this.claims.complete(tx, source, event))) throw new StaleClaimError();
  }

  private inScope<T>(source: OutboxSource, event: ClaimedEvent<unknown>, work: (tx: TenantTransaction | CrossTenantTransaction) => Promise<T>, timeoutMs: number): Promise<T> {
    return source === 'tenant' ? this.runner.withTenant(event.tenantId!, work, { timeoutMs }) : this.runner.withoutTenant(work, { timeoutMs });
  }

  private async recordFailure(source: OutboxSource, event: ClaimedEvent<unknown>, error: unknown): Promise<Outcome> {
    const where = { eventId: event.id, type: event.type, tenantId: event.tenantId, attempt: event.attempt };
    if (error instanceof StaleClaimError) {
      this.logger.warn({ message: 'Outbox claim was lost; the work was rolled back', ...where }, 'OutboxDispatcher');
      return 'stale';
    }
    const terminal = isPermanent(error) || isLastAttempt(event.attempt);
    const retryAt = terminal ? null : new Date(this.clock.now().getTime() + retryDelayMs(event.attempt));
    try {
      const recorded = await this.inScope(source, event, (tx) => this.claims.fail(tx, source, event, describeError(error), retryAt), this.settings.OUTBOX_TX_TIMEOUT_MS);
      if (!recorded) {
        this.logger.warn({ message: 'Outbox claim was lost before the failure was recorded', ...where }, 'OutboxDispatcher');
        return 'stale';
      }
    } catch (recordingError) {
      this.logger.error(recordingError, 'OutboxDispatcher');
    }
    this.logger.warn({ message: terminal ? 'Outbox event failed for good' : 'Outbox event failed and will be retried', error: describeError(error), ...where }, 'OutboxDispatcher');
    return terminal ? 'failed' : 'retried';
  }
}

function parsePayload<P>(schema: { safeParse(value: unknown): { success: true; data: P } | { success: false } }, payload: unknown): P {
  const result = schema.safeParse(payload);
  if (!result.success) throw new PermanentEventError('The payload does not match what the handler expects');
  return result.data;
}
