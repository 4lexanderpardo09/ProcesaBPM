import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Public } from '../../src/common/auth/public.decorator.js';
import { TenantTransactionRunner } from '../../src/infrastructure/database/tenant-transaction-runner.js';

/** Routes that exercise the data layer through the real authentication. Only used by tests. */
@Controller('test')
export class TenantProbeController {
  constructor(@Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner) {}

  @Get('companies')
  companies() {
    return this.runner.withTenantTransaction((tx) => tx.company.findMany({ select: { tenantId: true, name: true } }));
  }

  /** A public route has no tenant context: reaching tenant data must fail. */
  @Public()
  @Get('public-companies')
  publicCompanies() {
    return this.runner.withTenantTransaction((tx) => tx.company.findMany());
  }

  /** Changes the type of a step that already has transitions: the database rejects it with 23514. */
  @Get('invalid-step-change')
  invalidStepChange(@Query('stepId') stepId: string) {
    return this.runner.withTenantTransaction((tx) => tx.$executeRaw`UPDATE steps SET type = 'TASK' WHERE id = ${stepId}::uuid`);
  }
}
