import { Inject, Injectable } from '@nestjs/common';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PositionRepository } from '../data/position.repository.js';
import { NamedRecordsService } from './named-records.service.js';

@Injectable()
export class PositionsService extends NamedRecordsService {
  constructor(
    @Inject(TenantTransactionRunner) runner: TenantTransactionRunner,
    @Inject(TenantContext) context: TenantContext,
    @Inject(PositionRepository) repository: PositionRepository,
  ) {
    super(runner, context, repository);
  }
}
