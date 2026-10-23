import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type AnyPdfDesign, type PdfProblem, type TemplateMapping, validateDesign, validateMapping, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { WorkflowVersionQuery } from '../../workflows/application/workflow-version-query.js';
import { DocumentSourceRepository } from '../data/document-source.repository.js';
import { PdfImageRepository } from '../data/pdf-image.repository.js';

export interface CheckResult {
  /** Against the published version: tickets run on it, so these block the change. */
  readonly errors: PdfProblem[];
  /** Against the draft: they will block the next publication. */
  readonly warnings: PdfProblem[];
}

export interface SourceChecker {
  readonly document: WorkflowVersionDocument;
  design(design: AnyPdfDesign): CheckResult;
  mapping(mapping: TemplateMapping, template: Parameters<typeof validateMapping>[1]): CheckResult;
}

const sameProblem = (a: PdfProblem, b: PdfProblem): boolean => a.code === b.code && a.path === b.path && a.detail === b.detail;

/** Checks formats and mappings against a workflow's versions (published first, the draft as a heads-up), its images and the organization's positions and approval types. */
@Injectable()
export class DocumentSourceValidator {
  constructor(
    @Inject(WorkflowVersionQuery) private readonly versions: WorkflowVersionQuery,
    @Inject(PdfImageRepository) private readonly images: PdfImageRepository,
    @Inject(DocumentSourceRepository) private readonly sources: DocumentSourceRepository,
  ) {}

  async forWorkflow(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<SourceChecker> {
    const current = await this.versions.current(tx, tenantId, workflowId);
    if (current === null) throw new NotFoundError();
    const { published, draft } = current;
    const imageIds = await this.images.ids(tx, tenantId, workflowId);
    const positionIds = await this.sources.positionIds(tx, tenantId);
    const approvalTypeIds = await this.sources.approvalTypeIds(tx, tenantId);
    const run = (check: (document: WorkflowVersionDocument) => PdfProblem[]): CheckResult => {
      if (published === null) return { errors: draft === null ? [] : check(draft), warnings: [] };
      const errors = check(published);
      return { errors, warnings: draft === null ? [] : check(draft).filter((problem) => !errors.some((error) => sameProblem(error, problem))) };
    };
    return {
      document: published ?? draft ?? { steps: [], transitions: [], fields: [], amountRules: [] },
      design: (design) => run((document) => validateDesign(design, document, { imageIds, positionIds, approvalTypeIds })),
      mapping: (mapping, template) => run((document) => validateMapping(mapping, template, document)),
    };
  }
}
