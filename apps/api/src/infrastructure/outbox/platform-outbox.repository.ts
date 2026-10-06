import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import {
  PLATFORM_ADMIN_INVITATION_EVENT,
  TENANT_DELETION_REQUESTED_EVENT,
  type PlatformEventPayloads,
} from './platform-event-types.js';

/**
 * Events that belong to no tenant. The API can only enqueue (`enqueue_platform_event`, which checks the event type
 * against a whitelist); only the worker reads, completes or fails them. The payload types are the contract with the
 * worker's handlers: ids only.
 *
 * The platform-only e-mails have their own door in the database (`enqueue_platform_admin_invitation`,
 * `enqueue_tenant_deletion_requested`, granted to `app_platform` alone): the public `enqueue_platform_event` refuses
 * them, so the tenant API cannot queue them.
 */
@Injectable()
export class PlatformOutboxRepository {
  async enqueue<T extends keyof PlatformEventPayloads>(tx: Prisma.TransactionClient, type: T, payload: PlatformEventPayloads[T]): Promise<void> {
    if (type === PLATFORM_ADMIN_INVITATION_EVENT) {
      const { userId } = payload as PlatformEventPayloads[typeof PLATFORM_ADMIN_INVITATION_EVENT];
      await tx.$queryRaw`SELECT enqueue_platform_admin_invitation(${userId}::uuid)::text AS id`;
      return;
    }
    if (type === TENANT_DELETION_REQUESTED_EVENT) {
      const { tenantId, userId } = payload as PlatformEventPayloads[typeof TENANT_DELETION_REQUESTED_EVENT];
      await tx.$queryRaw`SELECT enqueue_tenant_deletion_requested(${tenantId}::uuid, ${userId}::uuid)::text AS id`;
      return;
    }
    await tx.$queryRaw`SELECT enqueue_platform_event(${type}, ${JSON.stringify(payload)}::jsonb)::text AS id`;
  }
}
