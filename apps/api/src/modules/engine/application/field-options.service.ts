import { Inject, Injectable } from '@nestjs/common';
import { type FieldOptionsQuery, type FieldOptionsResponse, NotFoundError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { FieldReferenceRepository } from '../data/field-reference.repository.js';

/**
 * What a person filling a form may pick in a field that stores ids (a person, a site, a preset list), with names.
 * Asked by the field, like the dataset options: the field's own filters (positions, site level) apply, and listing
 * people this way needs no permission over members.
 */
@Injectable()
export class FieldOptionsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(FieldReferenceRepository) private readonly references: FieldReferenceRepository,
  ) {}

  options(fieldId: string, query: FieldOptionsQuery): Promise<FieldOptionsResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const source = await this.references.sourceOfField(tx, tenantId, fieldId);
      if (source === null) throw new NotFoundError();
      return { options: await this.references.options(tx, tenantId, source, query.q, query.limit) };
    });
  }
}
