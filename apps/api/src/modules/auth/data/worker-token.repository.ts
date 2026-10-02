import { Injectable } from '@nestjs/common';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';

export interface TokenRecipient {
  readonly email: string;
  readonly firstName: string;
  readonly expiresAt: Date;
}

/** The worker-only functions that issue the one-time tokens (docs/base-de-datos.md §8): they store the hash, never the token. */
@Injectable()
export class WorkerTokenRepository {
  /** `undefined` when there is nothing to send: the account is not active, or the token was used, replaced or expired. */
  async issuePasswordReset(tx: WorkerTransaction, input: { eventId: string; userId: string; tokenHash: string; ttlMinutes: number }): Promise<TokenRecipient | undefined> {
    const [row] = await tx.$queryRaw<Array<{ out_email: string; out_first_name: string; out_expires_at: Date }>>`
      SELECT out_email, out_first_name, out_expires_at
      FROM worker_issue_password_reset_token(${input.eventId}::uuid, ${input.userId}::uuid, ${input.tokenHash}, make_interval(mins => ${input.ttlMinutes}::int))`;
    return row === undefined ? undefined : { email: row.out_email, firstName: row.out_first_name, expiresAt: row.out_expires_at };
  }

  /** `undefined` when the membership is no longer pending, the user is disabled or the organization is not active. */
  async issueInvitation(tx: WorkerTransaction, input: { eventId: string; tenantId: string; userId: string; tokenHash: string; ttlDays: number }): Promise<(TokenRecipient & { organization: string }) | undefined> {
    const [row] = await tx.$queryRaw<Array<{ out_email: string; out_first_name: string; out_tenant_name: string; out_expires_at: Date }>>`
      SELECT out_email, out_first_name, out_tenant_name, out_expires_at
      FROM worker_issue_invitation_token(${input.eventId}::uuid, ${input.tenantId}::uuid, ${input.userId}::uuid, ${input.tokenHash}, make_interval(days => ${input.ttlDays}::int))`;
    return row === undefined ? undefined : { email: row.out_email, firstName: row.out_first_name, organization: row.out_tenant_name, expiresAt: row.out_expires_at };
  }
}
