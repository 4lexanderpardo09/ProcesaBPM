import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';

/**
 * Events that belong to no tenant. The API can only enqueue (`enqueue_platform_event`, which checks
 * the event type against a whitelist); only the worker reads, completes or fails them.
 */
@Injectable()
export class PlatformOutboxRepository {
  async enqueue(tx: Prisma.TransactionClient, type: string, payload: Prisma.InputJsonObject): Promise<void> {
    await tx.$queryRaw`SELECT enqueue_platform_event(${type}, ${JSON.stringify(payload)}::jsonb)::text AS id`;
  }
}
