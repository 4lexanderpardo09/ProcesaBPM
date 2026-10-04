import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import type { DataExportReadyPayload } from '../../../infrastructure/outbox/platform-event-types.js';

export interface DataExportNotice {
  readonly email: string;
  readonly firstName: string;
  readonly timeZone: string | null;
  readonly organization: string;
  readonly expiresAt: Date;
}

/**
 * What the ready e-mail needs, read again when it is sent: nothing unless the export is READY and in date, it is the
 * user's, and they are still an active owner or administrator (`worker_data_export_notice`, §8.31). A forged event
 * (app_platform can queue one) names an export or a person that does not match, and sends nothing.
 */
@Injectable()
export class DataExportNoticeRepository {
  async find(tx: CrossTenantTransaction, payload: DataExportReadyPayload): Promise<DataExportNotice | undefined> {
    const [row] = await tx.$queryRaw<Array<{ email: string; first_name: string; time_zone: string | null; tenant_name: string; expires_at: Date }>>`
      SELECT out_email AS email, out_first_name AS first_name, out_time_zone AS time_zone, out_tenant_name AS tenant_name, out_expires_at AS expires_at
      FROM worker_data_export_notice(${payload.tenantId}::uuid, ${payload.exportId}::uuid, ${payload.userId}::uuid)`;
    return row === undefined ? undefined : { email: row.email, firstName: row.first_name, timeZone: row.time_zone, organization: row.tenant_name, expiresAt: row.expires_at };
  }
}
