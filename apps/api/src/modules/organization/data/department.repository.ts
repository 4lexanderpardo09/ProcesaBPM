import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type NamedRecordDelegate, NamedRecordRepository } from './named-record.repository.js';

@Injectable()
export class DepartmentRepository extends NamedRecordRepository {
  protected delegate(tx: TenantTransaction): NamedRecordDelegate {
    return tx.department;
  }
}
