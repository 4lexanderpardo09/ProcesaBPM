import type { Clock } from '../../../infrastructure/clock.js';
import { ExportTimeoutError, ExportTooLargeError } from '../domain/export-errors.js';

/**
 * The limits of one attempt, checked between pages and before every byte reaches the storage: the stop signal (lease
 * lost or worker stopping), the time budget and the size cap (decision B16).
 */
export class ExportBudget {
  private written = 0;

  constructor(
    private readonly clock: Clock,
    private readonly deadline: number,
    private readonly maxBytes: number,
    private readonly signal: AbortSignal,
  ) {}

  get bytesWritten(): number {
    return this.written;
  }

  check(): void {
    if (this.signal.aborted) throw this.signal.reason;
    if (this.clock.now().getTime() > this.deadline) throw new ExportTimeoutError();
  }

  /** Called before `bytes` more are sent: throws instead of sending past the cap. */
  addBytes(bytes: number): void {
    this.check();
    if (this.written + bytes > this.maxBytes) throw new ExportTooLargeError();
    this.written += bytes;
  }
}
