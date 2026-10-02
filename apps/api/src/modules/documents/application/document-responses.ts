import type { PdfFormatResponse, PdfTemplateResponse, PdfDesign, PdfProblem, WorkflowDocumentResponse } from '@procesabpm/shared';
import type { PdfFormatRow } from '../data/pdf-format.repository.js';
import type { PdfTemplateRow } from '../data/pdf-template.repository.js';
import type { WorkflowDocumentRow } from '../data/workflow-document.repository.js';

export const toProblemResponses = (problems: readonly PdfProblem[]) => problems.map((problem) => ({ code: problem.code, path: problem.path, ...(problem.detail === undefined ? {} : { detail: problem.detail }) }));

export const toFormatResponse = (row: PdfFormatRow, warnings: readonly PdfProblem[]): PdfFormatResponse => ({
  id: row.id,
  workflowId: row.workflowId,
  name: row.name,
  description: row.description,
  design: row.design as PdfDesign,
  fileNamePattern: row.fileNamePattern,
  isActive: row.isActive,
  updatedAt: row.updatedAt.toISOString(),
  warnings: toProblemResponses(warnings),
});

export const toTemplateResponse = (row: PdfTemplateRow): PdfTemplateResponse => ({
  id: row.id,
  workflowId: row.workflowId,
  companyId: row.companyId,
  fileId: row.fileId,
  name: row.name,
  pageCount: row.pages.length,
  hasAcroform: row.hasAcroform,
  acroformFields: row.acroformFields.map((field) => ({ name: field.name, type: field.type, page: field.page })),
  isActive: row.isActive,
  updatedAt: row.updatedAt.toISOString(),
});

export const toWorkflowDocumentResponse = (row: WorkflowDocumentRow): WorkflowDocumentResponse => ({
  id: row.id,
  workflowId: row.workflowId,
  companyId: row.companyId,
  kind: row.kind,
  formatId: row.formatId,
  templateId: row.templateId,
  moment: row.moment,
  isActive: row.isActive,
});
