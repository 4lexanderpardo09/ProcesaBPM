import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../common/logging/json-logger.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { WorkerTransactionRunner } from '../database/worker-transaction-runner.js';
import { encodeSignals, REALTIME_CHANNEL, type RealtimeSignal } from './realtime-signal.js';

const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * Sends id-only signals to the API instances with `pg_notify`, in a tiny transaction of its own. The outbox dispatcher
 * calls it only after the event's transaction committed, so a `NOTIFY` (which takes a database-wide lock at commit, and
 * fails the commit if the notification queue is full) never sits inside an engine or event transaction. Delivery is
 * at-most-once: the callers treat a failure as a lost hint.
 */
@Injectable()
export class RealtimeSignalPublisher {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async publish(signals: readonly RealtimeSignal[]): Promise<void> {
    if (!this.settings.REALTIME_SIGNALS_ENABLED || signals.length === 0) return;
    const payloads = encodeSignals(signals);
    await this.runner.withoutTenant(
      async (tx) => {
        for (const payload of payloads) await tx.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`;
      },
      { timeoutMs: PUBLISH_TIMEOUT_MS },
    );
    this.logger.debug(`Published ${payloads.length} realtime signal(s)`, 'RealtimeSignalPublisher');
  }
}
