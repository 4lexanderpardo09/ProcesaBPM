import type { RealtimeSignal } from './realtime-signal.js';

/**
 * Where the API instances get the worker's signals from. Postgres `LISTEN` today (`PgSignalListener`); Redis pub/sub can
 * replace it later without touching whoever consumes the signals.
 */
export abstract class RealtimeSignalSource {
  /** Called for every decoded signal except the listener's own self-test. */
  abstract onSignal(listener: (signal: RealtimeSignal) => void): void;
  /** Called after a reconnection: signals may have been lost in between. */
  abstract onGap(listener: () => void): void;
}
