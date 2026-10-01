import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { TenantContext } from '../../src/infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../src/infrastructure/database/tenant-transaction-runner.js';

/**
 * Stand-in for the authentication layer, which does not exist yet: the tenant and user come from
 * headers. Only used by tests.
 */
@Controller('test')
export class TenantProbeController {
  constructor(
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
  ) {}

  @Get('companies')
  companies(@Headers('x-tenant-id') tenantId: string | undefined, @Headers('x-user-id') userId: string | undefined) {
    const work = () =>
      this.runner.withTenantTransaction((tx) => tx.company.findMany({ select: { tenantId: true, name: true } }));
    return tenantId && userId ? this.tenantContext.run({ tenantId, userId }, work) : work();
  }

  /** Changes the type of a step that already has transitions: the database rejects it with 23514. */
  @Get('invalid-step-change')
  invalidStepChange(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-user-id') userId: string,
    @Headers('x-step-id') stepId: string,
  ) {
    return this.tenantContext.run({ tenantId, userId }, () =>
      this.runner.withTenantTransaction((tx) => tx.$executeRaw`UPDATE steps SET type = 'TASK' WHERE id = ${stepId}::uuid`),
    );
  }
}
