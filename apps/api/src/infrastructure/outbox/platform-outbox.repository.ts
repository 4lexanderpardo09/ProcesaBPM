import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { PlatformEventPayloads } from './platform-event-types.js';

/**
 * Events that belong to no tenant. The API can only enqueue (`enqueue_platform_event`, which checks the event type
 * against a whitelist); only the worker reads, completes or fails them. The payload types are the contract with the
 * worker's handlers: ids only.
 */
@Injectable()
export class PlatformOutboxRepository {
  async enqueue<T extends keyof PlatformEventPayloads>(tx: Prisma.TransactionClient, type: T, payload: PlatformEventPayloads[T]): Promise<void> {
    await tx.$queryRaw`SELECT enqueue_platform_event(${type}, ${JSON.stringify(payload)}::jsonb)::text AS id`;
  }
}
