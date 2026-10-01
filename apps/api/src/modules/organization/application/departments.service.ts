import { Inject, Injectable } from '@nestjs/common';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DepartmentRepository } from '../data/department.repository.js';
import { NamedRecordsService } from './named-records.service.js';

@Injectable()
export class DepartmentsService extends NamedRecordsService {
  constructor(
    @Inject(TenantTransactionRunner) runner: TenantTransactionRunner,
    @Inject(TenantContext) context: TenantContext,
    @Inject(DepartmentRepository) repository: DepartmentRepository,
  ) {
    super(runner, context, repository);
  }
}
