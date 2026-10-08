import { Injectable } from '@nestjs/common';
import type { UpdateTagRequest } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface TagRow {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

const SELECT = { id: true, name: true, color: true } as const;

/** Every query names the tenant and the owner: a tag belongs to one member, and RLS is the second wall. */
@Injectable()
export class TagRepository {
  list(tx: TenantTransaction, tenantId: string, ownerId: string): Promise<TagRow[]> {
    return tx.tag.findMany({ where: { tenantId, ownerId }, select: SELECT, orderBy: { name: 'asc' } });
  }

  create(tx: TenantTransaction, tenantId: string, ownerId: string, data: { name: string; color: string }): Promise<TagRow> {
    return tx.tag.create({ data: { tenantId, ownerId, ...data }, select: SELECT });
  }

  /** Someone else's tag looks exactly like a missing one. */
  findOwn(tx: TenantTransaction, tenantId: string, ownerId: string, id: string): Promise<TagRow | null> {
    return tx.tag.findFirst({ where: { tenantId, ownerId, id }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, ownerId: string, id: string, request: UpdateTagRequest): Promise<TagRow | null> {
    // Prisma does not take explicit `undefined` values with exactOptionalPropertyTypes: build only the sent fields.
    const data: { name?: string; color?: string } = {};
    if (request.name !== undefined) data.name = request.name;
    if (request.color !== undefined) data.color = request.color;
    const { count } = await tx.tag.updateMany({ where: { tenantId, ownerId, id }, data });
    return count === 0 ? null : this.findOwn(tx, tenantId, ownerId, id);
  }

  async remove(tx: TenantTransaction, tenantId: string, ownerId: string, id: string): Promise<boolean> {
    const { count } = await tx.tag.deleteMany({ where: { tenantId, ownerId, id } });
    return count > 0;
  }

  listForTicket(tx: TenantTransaction, tenantId: string, ticketId: string, ownerId: string): Promise<TagRow[]> {
    return tx.tag.findMany({
      where: { tenantId, ownerId, tickets: { some: { tenantId, ticketId, userId: ownerId } } },
      select: SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** Attaching the same tag twice is a no-op (the primary key is ticket + tag). */
  async attach(tx: TenantTransaction, tenantId: string, ticketId: string, tagId: string, userId: string): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO ticket_tags (tenant_id, ticket_id, tag_id, user_id)
      VALUES (${tenantId}::uuid, ${ticketId}::uuid, ${tagId}::uuid, ${userId}::uuid)
      ON CONFLICT (tenant_id, ticket_id, tag_id) DO NOTHING`;
  }

  async detach(tx: TenantTransaction, tenantId: string, ticketId: string, tagId: string, userId: string): Promise<void> {
    await tx.ticketTag.deleteMany({ where: { tenantId, ticketId, tagId, userId } });
  }
}
