import { Inject, Injectable } from '@nestjs/common';
import { checkDraftSpec, DomainError, type DraftSpecImported, ERROR_CODES, type ImportDraftSpecRequest, type SpecProblem } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DraftCatalogRepository } from '../data/draft-catalog.repository.js';
import { DraftDocumentImporter } from './draft-document-importer.js';

/** The template names a block, position, group or approval type that does not exist (in it or in the organization). */
export class DraftSpecRejectedError extends DomainError {
  constructor(problems: readonly SpecProblem[]) {
    super(ERROR_CODES.validationFailed, 'The template does not fit this organization', { details: { problems: problems.slice(0, 50) } });
  }
}

/**
 * Replaces a draft with a template in the format «Crear con IA» uses, without the AI: the same translation, the same
 * checks and the same importer, in one transaction. Design problems are kept for the person to fix, as on the canvas.
 */
@Injectable()
export class DraftSpecImportService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(DraftCatalogRepository) private readonly catalog: DraftCatalogRepository,
    @Inject(DraftDocumentImporter) private readonly importer: DraftDocumentImporter,
  ) {}

  import(workflowId: string, versionId: string, request: ImportDraftSpecRequest): Promise<DraftSpecImported> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const check = checkDraftSpec(request.spec, await this.catalog.load(tx, tenantId));
      if (check.kind === 'untranslatable') throw new DraftSpecRejectedError(check.problems);
      const { revision, validation } = await this.importer.replaceContent(tx, { tenantId, workflowId, versionId, expectedRevision: request.revision, document: check.document });
      return { revision, errors: validation.errors.length, warnings: validation.warnings.length };
    });
  }
}
