import { Injectable } from '@nestjs/common';
import type { WorkerTransaction } from '../database/worker-transaction-runner.js';
import type { ClaimedEvent } from './outbox-handler.js';
import { LEASE, MAX_ATTEMPTS } from './retry-policy.js';

export type OutboxSource = 'tenant' | 'platform';

interface ClaimRow {
  id: string;
  tenant_id?: string;
  type: string;
  payload: unknown;
  attempts: number;
  created_at: Date;
}

const toEvent = (row: ClaimRow): ClaimedEvent<unknown> => ({ id: row.id, tenantId: row.tenant_id ?? null, type: row.type, attempt: row.attempts, createdAt: row.created_at, payload: row.payload });

/**
 * The worker's side of both outboxes (docs/base-de-datos.md §6.3): claim with a lease, then complete or fail with the
 * attempt number as a fence. Tenant events complete and fail inside their own tenant's transaction; platform events
 * belong to no tenant.
 */
@Injectable()
export class OutboxClaimsRepository {
  async claimTenant(tx: WorkerTransaction, limit: number, types: readonly string[]): Promise<ClaimedEvent<unknown>[]> {
    const rows = await tx.$queryRaw<ClaimRow[]>`
      SELECT id::text AS id, tenant_id::text AS tenant_id, type, payload, attempts, created_at
      FROM claim_outbox_events(${limit}::int, ${[...types]}::text[], ${LEASE}::interval, ${MAX_ATTEMPTS}::int)`;
    return rows.map(toEvent);
  }

  async claimPlatform(tx: WorkerTransaction, limit: number): Promise<ClaimedEvent<unknown>[]> {
    const rows = await tx.$queryRaw<ClaimRow[]>`
      SELECT id::text AS id, type, payload, attempts, created_at
      FROM claim_platform_outbox_events(${limit}::int, ${LEASE}::interval, ${MAX_ATTEMPTS}::int)`;
    return rows.map(toEvent);
  }

  /** Whether this worker still owns the claim (not expired, not taken by another worker): asked before an e-mail is sent. */
  async isCurrent(tx: WorkerTransaction, source: OutboxSource, event: ClaimedEvent<unknown>): Promise<boolean> {
    const [row] =
      source === 'tenant'
        ? await tx.$queryRaw<Array<{ ok: boolean }>>`
            SELECT EXISTS (SELECT 1 FROM outbox_events WHERE tenant_id = app_current_tenant() AND id = ${event.id}::uuid
                           AND status = 'PROCESSING' AND attempts = ${event.attempt}::int AND available_at > now()) AS ok`
        : await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT platform_outbox_claim_is_current(${event.id}::uuid, ${event.attempt}::int) AS ok`;
    return row?.ok === true;
  }

  /** False when the lease ended and another worker owns the event now. */
  async complete(tx: WorkerTransaction, source: OutboxSource, event: ClaimedEvent<unknown>): Promise<boolean> {
    const [row] =
      source === 'tenant'
        ? await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT complete_outbox_event(${event.id}::uuid, ${event.attempt}::int) AS ok`
        : await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT complete_platform_outbox_event(${event.id}::uuid, ${event.attempt}::int) AS ok`;
    return row?.ok === true;
  }

  /** `retryAt` null (or the last attempt) is terminal. `error` must never carry payload data. */
  async fail(tx: WorkerTransaction, source: OutboxSource, event: ClaimedEvent<unknown>, error: string, retryAt: Date | null): Promise<boolean> {
    const [row] =
      source === 'tenant'
        ? await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT fail_outbox_event(${event.id}::uuid, ${event.attempt}::int, ${error}, ${retryAt}::timestamptz, ${MAX_ATTEMPTS}::int) AS ok`
        : await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT fail_platform_outbox_event(${event.id}::uuid, ${event.attempt}::int, ${error}, ${retryAt}::timestamptz, ${MAX_ATTEMPTS}::int) AS ok`;
    return row?.ok === true;
  }
}
