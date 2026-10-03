import type { z } from 'zod';
import type { CrossTenantTransaction, TenantTransaction } from '../database/transaction-scope.js';

export interface ClaimedEvent<P> {
  readonly id: string;
  /** `null` for platform events. */
  readonly tenantId: string | null;
  readonly type: string;
  /** Claims so far, this one included: it fences the result of a worker whose lease already ended. */
  readonly attempt: number;
  readonly createdAt: Date;
  readonly payload: P;
}

/**
 * Only changes the database (fan-out, notifications). It runs in the same transaction that completes the event:
 * its effects and the completion commit together, or neither does, so they happen exactly once.
 */
export interface TransactionalHandler<P> {
  readonly type: string;
  readonly schema: z.ZodType<P>;
  handle(tx: TenantTransaction, event: ClaimedEvent<P>): Promise<void>;
}

/**
 * Has one effect outside the database (an e-mail). `prepare` reads or writes what it needs in a transaction and
 * returns what to send (or `null` when there is nothing to do); `perform` sends it with no transaction open; then
 * the event completes (after `record`, when there is one). Delivery is at-least-once: a duplicate needs a crash between `perform` and the completion,
 * and carries the same deterministic message, so the receiver can recognize it.
 */
export interface ExternalEffectHandler<P, M, R = void, Tx extends TenantTransaction | CrossTenantTransaction = TenantTransaction> {
  readonly type: string;
  /** Tenant events run in that tenant's scope; platform events have no tenant, so only the cross-tenant functions. */
  readonly scope: Tx extends CrossTenantTransaction ? 'platform' : 'tenant';
  readonly schema: z.ZodType<P>;
  prepare(tx: Tx, event: ClaimedEvent<P>): Promise<M | null>;
  perform(message: M, event: ClaimedEvent<P>): Promise<R>;
  /**
   * Optional: stores what `perform` produced, in the same transaction that completes the event. A claim that lost
   * its lease rolls it back, so whoever owns the event next records it exactly once.
   */
  record?(tx: Tx, result: R, event: ClaimedEvent<P>): Promise<void>;
}

/**
 * How the dispatcher holds a registered handler: the registration tied `scope` to the transaction type, so the dispatcher
 * opens the matching scope and hands the transaction over without knowing which brand the handler declared.
 */
export interface RegisteredExternalHandler {
  readonly type: string;
  readonly scope: 'tenant' | 'platform';
  readonly schema: z.ZodType<never>;
  prepare(tx: never, event: ClaimedEvent<never>): Promise<unknown>;
  perform(message: never, event: ClaimedEvent<never>): Promise<unknown>;
  record?(tx: never, result: never, event: ClaimedEvent<never>): Promise<void>;
}

/** Retrying cannot help (an invalid payload, a permanent delivery error): the event goes straight to FAILED. */
export class PermanentEventError extends Error {
  override readonly name = 'PermanentEventError';
}

/** The lease ended and somebody else owns the event now: whatever this worker did is rolled back. */
export class StaleClaimError extends Error {
  override readonly name = 'StaleClaimError';
}
