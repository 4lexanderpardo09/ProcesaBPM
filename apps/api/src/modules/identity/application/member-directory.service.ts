import { Inject, Injectable } from '@nestjs/common';
import { type DirectoryPerson, MEMBER_DIRECTORY_LIMIT, type MemberDirectoryQuery } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type DirectoryRow, MemberRepository } from '../data/member.repository.js';

const toPerson = (row: DirectoryRow): DirectoryPerson => ({ userId: row.userId, firstName: row.user.firstName, lastName: row.user.lastName });

/**
 * Who one's colleagues are, for every member: to choose someone to delegate to or share a template with, and to name
 * the people a delegation or a share points at. Only ids and names; the rest of a membership needs `read Membership`.
 */
@Injectable()
export class MemberDirectoryService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(MemberRepository) private readonly repository: MemberRepository,
  ) {}

  find(query: MemberDirectoryQuery): Promise<DirectoryPerson[]> {
    const tenantId = this.context.require().tenantId;
    return this.runner.withTenantTransaction(async (tx) => {
      const rows = query.ids === undefined ? await this.repository.searchDirectory(tx, tenantId, query.search ?? '', MEMBER_DIRECTORY_LIMIT) : await this.repository.namesOf(tx, tenantId, query.ids);
      return rows.map(toPerson);
    });
  }
}
