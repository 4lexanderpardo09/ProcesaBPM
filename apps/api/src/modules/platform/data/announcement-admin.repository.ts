import { Injectable } from '@nestjs/common';
import type { AnnouncementRequest, PlatformAnnouncementResponse } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

type Row = {
  id: string;
  type: PlatformAnnouncementResponse['type'];
  title: string;
  body: string;
  startsAt: Date;
  endsAt: Date | null;
  blocksLogin: boolean;
  audience: PlatformAnnouncementResponse['audience'];
  targets: Array<{ tenantId: string }>;
};

const toAnnouncementResponse = (row: Row): PlatformAnnouncementResponse => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  blocksLogin: row.blocksLogin,
  audience: row.audience,
  tenantIds: row.targets.map((target) => target.tenantId).sort(),
});

const toData = (request: AnnouncementRequest) => ({
  type: request.type,
  title: request.title,
  body: request.body,
  startsAt: new Date(request.startsAt),
  endsAt: request.endsAt === null ? null : new Date(request.endsAt),
  blocksLogin: request.blocksLogin,
  audience: request.audience,
});

const WITH_TARGETS = { targets: { select: { tenantId: true } } } as const;

/**
 * The targets are replaced in the same transaction as the announcement: the database checks at COMMIT that a TENANTS
 * announcement keeps at least one (23514), and an unknown tenant fails its foreign key (23503 → 422 `INVALID_REFERENCE`).
 */
@Injectable()
export class AnnouncementAdminRepository {
  async list(tx: PlatformTransaction): Promise<PlatformAnnouncementResponse[]> {
    const rows = await tx.platformAnnouncement.findMany({ include: WITH_TARGETS, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] });
    return rows.map(toAnnouncementResponse);
  }

  async create(tx: PlatformTransaction, request: AnnouncementRequest): Promise<PlatformAnnouncementResponse> {
    const { id } = await tx.platformAnnouncement.create({ data: toData(request), select: { id: true } });
    await this.replaceTargets(tx, id, request.tenantIds);
    return this.findOrThrow(tx, id);
  }

  /** `undefined` when it does not exist. */
  async update(tx: PlatformTransaction, id: string, request: AnnouncementRequest): Promise<PlatformAnnouncementResponse | undefined> {
    const { count } = await tx.platformAnnouncement.updateMany({ where: { id }, data: toData(request) });
    if (count === 0) return undefined;
    await this.replaceTargets(tx, id, request.tenantIds);
    return this.findOrThrow(tx, id);
  }

  async delete(tx: PlatformTransaction, id: string): Promise<boolean> {
    const { count } = await tx.platformAnnouncement.deleteMany({ where: { id } });
    return count > 0;
  }

  private async replaceTargets(tx: PlatformTransaction, announcementId: string, tenantIds: readonly string[]): Promise<void> {
    await tx.platformAnnouncementTenant.deleteMany({ where: { announcementId } });
    if (tenantIds.length > 0) await tx.platformAnnouncementTenant.createMany({ data: tenantIds.map((tenantId) => ({ tenantId, announcementId })) });
  }

  private async findOrThrow(tx: PlatformTransaction, id: string): Promise<PlatformAnnouncementResponse> {
    return toAnnouncementResponse(await tx.platformAnnouncement.findUniqueOrThrow({ where: { id }, include: WITH_TARGETS }));
  }
}
