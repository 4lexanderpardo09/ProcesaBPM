import { Injectable } from '@nestjs/common';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { LoginBlock } from '../domain/login-block-policy.js';

interface LoginBlockRow {
  readonly id: string;
  readonly type: LoginBlock['type'];
  readonly title: string;
  readonly body: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly allTenants: boolean;
  readonly tenantIds: string[];
}

/** Through `auth_login_blocks()` (docs/base-de-datos.md §8.30): the target tenants are not readable by the API's role. */
@Injectable()
export class LoginBlockRepository {
  async list(tx: AuthTransaction): Promise<LoginBlock[]> {
    const rows = await tx.$queryRaw<LoginBlockRow[]>`
      SELECT out_id AS id, out_type::text AS type, out_title AS title, out_body AS body, out_starts_at AS "startsAt", out_ends_at AS "endsAt",
             out_all_tenants AS "allTenants", out_tenant_ids AS "tenantIds"
      FROM auth_login_blocks()`;
    return rows.map((row) => ({ ...row, tenantIds: [...row.tenantIds] }));
  }
}
