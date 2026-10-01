import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { PermissionDeniedError } from '@procesabpm/shared';
import { Public } from '../../src/common/auth/public.decorator.js';
import { RequirePermission, RequireAnyPermission } from '../../src/common/auth/route-access.js';
import { TenantTransactionRunner } from '../../src/infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../src/modules/authorization/domain/build-ability.js';
import { accessibleWhere, assertCanOnRecord } from '../../src/modules/authorization/domain/record-access.js';
import { TEST_SUBJECT } from './test-subjects.js';
import { CurrentAbility } from '../../src/modules/authorization/http/current-ability.decorator.js';

/** Records of the fake subject `TestDoc` (the tickets module does not exist yet); tests fill it in. */
export const TEST_RECORDS: Array<Record<string, string>> = [];

/** Routes that exercise the data layer and the authorization through the real guards. Only used by tests. */
@Controller('test')
export class TenantProbeController {
  constructor(@Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner) {}

  @RequirePermission('read', 'Company')
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
  @RequirePermission('update', 'Workflow')
  @Get('invalid-step-change')
  invalidStepChange(@Query('stepId') stepId: string) {
    return this.runner.withTenantTransaction((tx) => tx.$executeRaw`UPDATE steps SET type = 'TASK' WHERE id = ${stepId}::uuid`);
  }

  /** Authenticated, but declares no permission and no opt-out: must be refused (deny by default). */
  @Get('undeclared')
  undeclared() {
    return { reached: true };
  }

  /** The type-level permission passes for any role with a TestDoc rule; the record decides. */
  @RequireAnyPermission(['read_own', 'read_all'], TEST_SUBJECT)
  @Get('records/:id')
  record(@Param('id') id: string, @CurrentAbility() ability: AppAbility) {
    const record = TEST_RECORDS.find((candidate) => candidate.id === id);
    if (record === undefined) throw new PermissionDeniedError('unknown record');
    assertCanOnRecord(ability, ['read_own', 'read_all'], TEST_SUBJECT, record);
    return record;
  }

  /** The listing keeps only the records the caller may see. */
  @RequireAnyPermission(['read_own', 'read_all'], TEST_SUBJECT)
  @Get('records')
  records(@CurrentAbility() ability: AppAbility) {
    const where = accessibleWhere(ability, ['read_own', 'read_all'], TEST_SUBJECT);
    return { where };
  }
}
