import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { UpdateTextTemplateRequest } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';

const SELECT = {
  id: true,
  title: true,
  bodyHtml: true,
  ownerId: true,
  updatedAt: true,
  owner: { select: { user: { select: { firstName: true, lastName: true } } } },
} as const;

type TextTemplateRecord = Prisma.TextTemplateGetPayload<{ select: typeof SELECT }>;

export interface TextTemplateRow {
  readonly id: string;
  readonly title: string;
  readonly bodyHtml: string;
  readonly ownerId: string;
  readonly ownerFirstName: string;
  readonly ownerLastName: string;
  readonly updatedAt: Date;
}

const toRow = (row: TextTemplateRecord): TextTemplateRow => ({
  id: row.id,
  title: row.title,
  bodyHtml: row.bodyHtml,
  ownerId: row.ownerId,
  ownerFirstName: row.owner.user.firstName,
  ownerLastName: row.owner.user.lastName,
  updatedAt: row.updatedAt,
});

/** Every query names the tenant; a template is readable by its owner and by those it was shared with. */
@Injectable()
export class TextTemplateRepository {
  async list(tx: TenantTransaction, tenantId: string, userId: string): Promise<TextTemplateRow[]> {
    const rows = await tx.textTemplate.findMany({
      where: { tenantId, OR: [{ ownerId: userId }, { shares: { some: { tenantId, userId } } }] },
      select: SELECT,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toRow);
  }

  /** A template the caller may not read answers exactly like a missing one. */
  async findReadable(tx: TenantTransaction, tenantId: string, userId: string, id: string): Promise<TextTemplateRow | null> {
    const row = await tx.textTemplate.findFirst({
      where: { tenantId, id, OR: [{ ownerId: userId }, { shares: { some: { tenantId, userId } } }] },
      select: SELECT,
    });
    return row === null ? null : toRow(row);
  }

  async findOwn(tx: TenantTransaction, tenantId: string, userId: string, id: string): Promise<TextTemplateRow | null> {
    const row = await tx.textTemplate.findFirst({ where: { tenantId, id, ownerId: userId }, select: SELECT });
    return row === null ? null : toRow(row);
  }

  async create(tx: TenantTransaction, tenantId: string, ownerId: string, data: { title: string; bodyHtml: string }): Promise<TextTemplateRow> {
    const row = await tx.textTemplate.create({ data: { tenantId, ownerId, title: data.title, bodyHtml: sanitizeRichText(data.bodyHtml) }, select: SELECT });
    return toRow(row);
  }

  async update(tx: TenantTransaction, tenantId: string, ownerId: string, id: string, request: UpdateTextTemplateRequest): Promise<TextTemplateRow | null> {
    // Prisma does not take explicit `undefined` values with exactOptionalPropertyTypes: build only the sent fields.
    const data: { title?: string; bodyHtml?: string } = {};
    if (request.title !== undefined) data.title = request.title;
    if (request.bodyHtml !== undefined) data.bodyHtml = sanitizeRichText(request.bodyHtml);
    const { count } = await tx.textTemplate.updateMany({ where: { tenantId, ownerId, id }, data });
    return count === 0 ? null : this.findOwn(tx, tenantId, ownerId, id);
  }

  async remove(tx: TenantTransaction, tenantId: string, ownerId: string, id: string): Promise<boolean> {
    const { count } = await tx.textTemplate.deleteMany({ where: { tenantId, ownerId, id } });
    return count > 0;
  }

  async listShares(tx: TenantTransaction, tenantId: string, templateId: string): Promise<string[]> {
    const rows = await tx.textTemplateShare.findMany({ where: { tenantId, templateId }, select: { userId: true }, orderBy: { userId: 'asc' } });
    return rows.map((row) => row.userId);
  }

  /** Replaces the whole list in one operation (the owner is never in it: the service drops them). */
  async replaceShares(tx: TenantTransaction, tenantId: string, templateId: string, userIds: readonly string[]): Promise<void> {
    await tx.textTemplateShare.deleteMany({ where: { tenantId, templateId } });
    await tx.textTemplateShare.createMany({ data: userIds.map((userId) => ({ tenantId, templateId, userId })) });
  }

  /** The members of the tenant among the given ids: a share to an outsider is dropped, never written. */
  async memberIdsAmong(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await tx.membership.findMany({ where: { tenantId, userId: { in: [...userIds] } }, select: { userId: true } });
    return rows.map((row) => row.userId);
  }
}
