import { Injectable } from '@nestjs/common';
import type { AnnouncementResponse } from '@procesabpm/shared';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

type Row = { id: string; type: AnnouncementResponse['type']; title: string; body: string; startsAt: Date; endsAt: Date | null; blocksLogin: boolean };

const toResponse = (row: Row): AnnouncementResponse => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  blocksLogin: row.blocksLogin,
});

const inForce = (now: Date) => ({ startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] });

const NEWEST_FIRST = [{ startsAt: 'desc' as const }, { id: 'desc' as const }];

const PUBLIC_FIELDS = { id: true, type: true, title: true, body: true, startsAt: true, endsAt: true, blocksLogin: true } as const;

/** Platform announcements have no tenant; members may only read them. Their target tenants are under RLS. */
@Injectable()
export class ActiveAnnouncementRepository {
  /**
   * Those for every organization and those that name this one. RLS already hides other tenants' target rows; the
   * explicit tenant filter keeps the query right even without it.
   */
  async listForTenant(tx: TenantTransaction, tenantId: string, now: Date): Promise<AnnouncementResponse[]> {
    const rows = await tx.platformAnnouncement.findMany({
      where: { AND: [inForce(now), { OR: [{ audience: 'ALL' }, { targets: { some: { tenantId } } }] }] },
      select: PUBLIC_FIELDS,
      orderBy: NEWEST_FIRST,
    });
    return rows.map(toResponse);
  }

  /** Before signing in nobody has a tenant: only the announcements for every organization are public. */
  async listForEveryTenant(tx: AuthTransaction, now: Date): Promise<AnnouncementResponse[]> {
    const rows = await tx.platformAnnouncement.findMany({ where: { ...inForce(now), audience: 'ALL' }, select: PUBLIC_FIELDS, orderBy: NEWEST_FIRST });
    return rows.map(toResponse);
  }
}
