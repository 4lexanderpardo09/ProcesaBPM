import { Injectable } from '@nestjs/common';
import type { AnnouncementResponse } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** Platform announcements are global (no tenant, no row-level security); members may only read them. */
@Injectable()
export class ActiveAnnouncementRepository {
  async listActive(tx: TenantTransaction, now: Date): Promise<AnnouncementResponse[]> {
    const rows = await tx.platformAnnouncement.findMany({
      where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      blocksLogin: row.blocksLogin,
    }));
  }
}
