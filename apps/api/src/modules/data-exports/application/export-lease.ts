import type { Clock } from '../../../infrastructure/clock.js';
import { ExportLeaseLostError } from '../domain/export-errors.js';

/** The claim's lease in the database; the heartbeat renews it to this every minute. Capped at 30 minutes by the DB. */
export const EXPORT_LEASE_MINUTES = 30;
export const EXPORT_HEARTBEAT_MS = 60_000;
/** With no successful renewal for this long (the database unreachable), the lease may end soon: stop before it does. */
export const EXPORT_LEASE_SAFETY_MS = 25 * 60_000;

/**
 * Keeps the export's claim alive while the archive is written. A refused renewal (another worker owns it, or the purge
 * is due) aborts `signal` with ExportLeaseLostError: from then on nothing may be written.
 */
export class ExportLease {
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private lastRenewedAt: number;
  private beating: Promise<void> | undefined;

  constructor(
    private readonly renew: () => Promise<boolean>,
    private readonly clock: Clock,
    private readonly onRenewError: (error: unknown) => void,
  ) {
    this.lastRenewedAt = clock.now().getTime();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(intervalMs = EXPORT_HEARTBEAT_MS): void {
    this.timer = setInterval(() => void this.beat(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * The last check before the object becomes visible: a renewal that must succeed now. A refusal loses the lease, and a
   * renewal that fails (the database unreachable) fails the attempt too: the object is only completed on a fresh lease.
   */
  async confirm(): Promise<void> {
    if (this.signal.aborted) throw this.signal.reason;
    await this.beating;
    if (this.signal.aborted) throw this.signal.reason;
    if (!(await this.renew())) {
      this.lose();
      throw this.signal.reason;
    }
    this.lastRenewedAt = this.clock.now().getTime();
  }

  /** One renewal at a time; a beat while one is in flight waits for it. */
  beat(): Promise<void> {
    this.beating ??= this.renewOnce().finally(() => {
      this.beating = undefined;
    });
    return this.beating;
  }

  private async renewOnce(): Promise<void> {
    if (this.signal.aborted) return;
    try {
      if (await this.renew()) this.lastRenewedAt = this.clock.now().getTime();
      else this.lose();
    } catch (error) {
      this.onRenewError(error);
      if (this.clock.now().getTime() - this.lastRenewedAt > EXPORT_LEASE_SAFETY_MS) this.lose();
    }
  }

  private lose(): void {
    this.stop();
    this.controller.abort(new ExportLeaseLostError());
  }
}
