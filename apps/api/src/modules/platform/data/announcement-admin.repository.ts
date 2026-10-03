import { Injectable } from '@nestjs/common';
import type { AnnouncementRequest, AnnouncementResponse } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

type Row = { id: string; type: AnnouncementResponse['type']; title: string; body: string; startsAt: Date; endsAt: Date | null; blocksLogin: boolean };

export const toAnnouncementResponse = (row: Row): AnnouncementResponse => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  blocksLogin: row.blocksLogin,
});

const toData = (request: AnnouncementRequest) => ({
  type: request.type,
  title: request.title,
  body: request.body,
  startsAt: new Date(request.startsAt),
  endsAt: request.endsAt === null ? null : new Date(request.endsAt),
  blocksLogin: request.blocksLogin,
});

@Injectable()
export class AnnouncementAdminRepository {
  async list(tx: PlatformTransaction): Promise<AnnouncementResponse[]> {
    const rows = await tx.platformAnnouncement.findMany({ orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] });
    return rows.map(toAnnouncementResponse);
  }

  async create(tx: PlatformTransaction, request: AnnouncementRequest): Promise<AnnouncementResponse> {
    return toAnnouncementResponse(await tx.platformAnnouncement.create({ data: toData(request) }));
  }

  /** `undefined` when it does not exist. */
  async update(tx: PlatformTransaction, id: string, request: AnnouncementRequest): Promise<AnnouncementResponse | undefined> {
    const { count } = await tx.platformAnnouncement.updateMany({ where: { id }, data: toData(request) });
    if (count === 0) return undefined;
    return toAnnouncementResponse(await tx.platformAnnouncement.findUniqueOrThrow({ where: { id } }));
  }

  async delete(tx: PlatformTransaction, id: string): Promise<boolean> {
    const { count } = await tx.platformAnnouncement.deleteMany({ where: { id } });
    return count > 0;
  }
}
