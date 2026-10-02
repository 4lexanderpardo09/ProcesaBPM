import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type PdfDesign, type PdfProblem, type WorkflowProblem, type WorkflowVersionDocument, validateDesign, validateMapping, parseBlockConfig } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type PublicationCheck, PublicationCheckRegistry } from '../../workflows/application/publication-check.registry.js';
import { DocumentSourceRepository } from '../data/document-source.repository.js';

const asProblem = (problem: PdfProblem, stepId?: string): WorkflowProblem => ({
  code: problem.code,
  severity: 'error',
  ...(stepId === undefined ? {} : { stepId }),
  params: { path: problem.path, ...(problem.detail === undefined ? {} : { detail: problem.detail }) },
});

/**
 * A draft cannot be published if a document it will produce no longer fits it: the fields, columns and steps a format
 * or a mapping names must exist in the version that is about to run. It covers the documents asked for by DOCUMENT blocks
 * and the active ones that run at a moment.
 */
@Injectable()
export class DocumentSourcesPublicationCheck implements PublicationCheck, OnModuleInit {
  constructor(
    @Inject(PublicationCheckRegistry) private readonly registry: PublicationCheckRegistry,
    @Inject(DocumentSourceRepository) private readonly sources: DocumentSourceRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async check(tx: TenantTransaction, tenantId: string, workflowId: string, document: WorkflowVersionDocument): Promise<WorkflowProblem[]> {
    const problems: WorkflowProblem[] = [];
    const checked = new Set<string>();
    const verify = async (workflowDocumentId: string, stepId?: string): Promise<void> => {
      if (checked.has(workflowDocumentId)) return;
      checked.add(workflowDocumentId);
      const source = await this.sources.findWorkflowDocument(tx, tenantId, workflowDocumentId);
      if (source === null || source.workflowId !== workflowId) return;
      if (!source.isActive && stepId !== undefined) problems.push({ code: 'DOCUMENT_SOURCE_INACTIVE', severity: 'error', stepId, params: { workflowDocumentId } });
      if (!source.isActive) return;
      if (source.format !== null) problems.push(...validateDesign(source.format.design as PdfDesign, document).map((problem) => asProblem(problem, stepId)));
      if (source.template !== null) {
        const template = await this.sources.templateShape(tx, tenantId, source.template.id);
        const mapping = { fields: source.template.fields.map(toMappedField), signatures: source.template.signatures.map(toMappedSignature) };
        problems.push(...validateMapping(mapping as never, template, document).map((problem) => asProblem(problem, stepId)));
      }
    };
    for (const step of document.steps.filter((candidate) => candidate.type === 'DOCUMENT')) {
      const parsed = parseBlockConfig('DOCUMENT', step.config);
      if (parsed.valid) await verify(parsed.config.workflowDocumentId as string, step.id);
    }
    for (const id of await this.sources.activeMomentDocuments(tx, tenantId, workflowId)) await verify(id);
    return problems;
  }
}

const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null));
const toMappedField = (row: object) => defined(row);
const toMappedSignature = (row: object) => defined(row);
