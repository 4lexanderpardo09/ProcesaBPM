import { Injectable } from '@nestjs/common';
import type { DemoTeamSize } from '@procesabpm/shared';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import type { DemoRequestMailInput } from '../domain/demo-request-email.js';

/** The worker's read of one request for its e-mail (`worker_demo_request`, `app_worker` only). */
@Injectable()
export class DemoRequestMailRepository {
  async find(tx: CrossTenantTransaction, demoRequestId: string): Promise<DemoRequestMailInput | undefined> {
    const [row] = await tx.$queryRaw<Array<{ out_full_name: string; out_company: string; out_email: string; out_team_size: DemoTeamSize; out_process: string | null; out_created_at: Date }>>`
      SELECT out_full_name, out_company, out_email, out_team_size::text AS out_team_size, out_process, out_created_at FROM worker_demo_request(${demoRequestId}::uuid)`;
    if (row === undefined) return undefined;
    return { fullName: row.out_full_name, company: row.out_company, email: row.out_email, teamSize: row.out_team_size, process: row.out_process, createdAt: row.out_created_at };
  }
}
