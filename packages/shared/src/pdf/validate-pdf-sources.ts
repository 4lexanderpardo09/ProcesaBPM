import type { FieldDocument, StepDocument, WorkflowVersionDocument } from '../workflow/document.js';
import { type Path, type ParsedExpression, parseExpression, pathsOf } from './expression.js';
import type { PdfBlock, PdfDesign } from './design-schema.js';
import { type AcroFieldInfo, displayedSize, type PageBox, type TemplateMapping } from './mapping-schema.js';

export interface PdfProblem {
  readonly code:
    | 'DOCUMENT_FIELD_UNKNOWN'
    | 'DOCUMENT_FIELD_TYPE_MISMATCH'
    | 'DOCUMENT_ROW_OUTSIDE_TABLE'
    | 'DOCUMENT_TABLE_COLUMN_UNKNOWN'
    | 'DOCUMENT_SIGNATURE_STEP_UNKNOWN'
    | 'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE'
    | 'DOCUMENT_STEP_UNKNOWN'
    | 'PAGE_AND_PAGES_OUTSIDE_BAND'
    | 'ACROFORM_FIELD_UNKNOWN'
    | 'COORDINATE_OUT_OF_PAGE';
  /** Where in the design or the mapping, e.g. `body[2].items[0].value`. */
  readonly path: string;
  readonly detail?: string;
}

const PEOPLE_STEP_TYPES: ReadonlySet<string> = new Set(['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE']);

interface Scope {
  readonly fields: ReadonlyMap<string, FieldDocument>;
  readonly steps: ReadonlyMap<string, StepDocument>;
}

function scopeOf(doc: WorkflowVersionDocument): Scope {
  return { fields: new Map(doc.fields.map((field) => [field.code, field])), steps: new Map(doc.steps.map((step) => [step.name, step])) };
}

const tableColumns = (field: FieldDocument): string[] => (Array.isArray(field.config.columns) ? (field.config.columns as Array<{ code?: unknown }>).flatMap((column) => (typeof column.code === 'string' ? [column.code] : [])) : []);

function checkPath(path: Path, at: string, scope: Scope, row: FieldDocument | undefined, inFrame: boolean, problems: PdfProblem[]): void {
  if (path.kind === 'field') {
    const field = scope.fields.get(path.code);
    if (field === undefined) problems.push({ code: 'DOCUMENT_FIELD_UNKNOWN', path: at, detail: path.code });
    else if (field.type === 'TABLE') problems.push({ code: 'DOCUMENT_FIELD_TYPE_MISMATCH', path: at, detail: `${path.code} is a table: use a table block` });
  } else if (path.kind === 'row') {
    if (row === undefined) problems.push({ code: 'DOCUMENT_ROW_OUTSIDE_TABLE', path: at, detail: path.code });
    else if (!tableColumns(row).includes(path.code)) problems.push({ code: 'DOCUMENT_TABLE_COLUMN_UNKNOWN', path: at, detail: path.code });
  } else if (path.kind === 'step') {
    if (!scope.steps.has(path.stepName)) problems.push({ code: 'DOCUMENT_STEP_UNKNOWN', path: at, detail: path.stepName });
  } else if ((path.kind === 'page' || path.kind === 'pages') && !inFrame) {
    problems.push({ code: 'PAGE_AND_PAGES_OUTSIDE_BAND', path: at });
  }
}

function checkExpression(text: string, at: string, scope: Scope, row: FieldDocument | undefined, inFrame: boolean, problems: PdfProblem[]): void {
  const parsed = parseExpression(text);
  if (parsed.ok) for (const path of pathsOf(parsed.expression as ParsedExpression)) checkPath(path, at, scope, row, inFrame, problems);
}

function checkRules(rules: ReadonlyArray<{ field: string }> | undefined, at: string, scope: Scope, problems: PdfProblem[]): void {
  for (const [index, rule] of (rules ?? []).entries()) if (!scope.fields.has(rule.field)) problems.push({ code: 'DOCUMENT_FIELD_UNKNOWN', path: `${at}.visibleWhen[${index}]`, detail: rule.field });
}

function checkSlot(slot: { stepName: string }, at: string, scope: Scope, problems: PdfProblem[]): void {
  const step = scope.steps.get(slot.stepName);
  if (step === undefined) problems.push({ code: 'DOCUMENT_SIGNATURE_STEP_UNKNOWN', path: at, detail: slot.stepName });
  else if (!PEOPLE_STEP_TYPES.has(step.type)) problems.push({ code: 'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE', path: at, detail: slot.stepName });
}

function checkBlock(block: PdfBlock, at: string, scope: Scope, inFrame: boolean, problems: PdfProblem[]): void {
  checkRules(block.visibleWhen, at, scope, problems);
  switch (block.type) {
    case 'text':
    case 'heading':
      checkExpression(block.text, `${at}.text`, scope, undefined, inFrame, problems);
      break;
    case 'fields':
      for (const [index, item] of block.items.entries()) checkExpression(item.value, `${at}.items[${index}].value`, scope, undefined, inFrame, problems);
      break;
    case 'allFields':
      for (const [index, code] of (block.exclude ?? []).entries()) if (!scope.fields.has(code)) problems.push({ code: 'DOCUMENT_FIELD_UNKNOWN', path: `${at}.exclude[${index}]`, detail: code });
      break;
    case 'table': {
      const field = scope.fields.get(block.fieldCode);
      if (field === undefined) problems.push({ code: 'DOCUMENT_FIELD_UNKNOWN', path: `${at}.fieldCode`, detail: block.fieldCode });
      else if (field.type !== 'TABLE') problems.push({ code: 'DOCUMENT_FIELD_TYPE_MISMATCH', path: `${at}.fieldCode`, detail: `${block.fieldCode} is not a table` });
      for (const [index, column] of block.columns.entries()) checkExpression(column.value, `${at}.columns[${index}].value`, scope, field?.type === 'TABLE' ? field : undefined, inFrame, problems);
      break;
    }
    case 'signatures':
      for (const [index, slot] of block.slots.entries()) {
        checkSlot(slot, `${at}.slots[${index}]`, scope, problems);
        if (slot.caption !== undefined) checkExpression(slot.caption, `${at}.slots[${index}].caption`, scope, undefined, inFrame, problems);
      }
      break;
    default:
      break;
  }
}

/** Checks a designer format against a workflow version: every field, table column and step it names must exist. */
export function validateDesign(design: PdfDesign, doc: WorkflowVersionDocument): PdfProblem[] {
  const scope = scopeOf(doc);
  const problems: PdfProblem[] = [];
  for (const [index, block] of design.body.entries()) checkBlock(block, `body[${index}]`, scope, false, problems);
  for (const band of ['header', 'footer'] as const) for (const [index, block] of (design[band]?.blocks ?? []).entries()) checkBlock(block, `${band}.blocks[${index}]`, scope, true, problems);
  return problems;
}

/** Checks the mapping of an uploaded PDF: fields and steps exist, AcroForm names are in the PDF, coordinates are on the page. */
export function validateMapping(mapping: TemplateMapping, template: { readonly pages: readonly PageBox[]; readonly acroformFields: readonly AcroFieldInfo[] }, doc: WorkflowVersionDocument): PdfProblem[] {
  const scope = scopeOf(doc);
  const problems: PdfProblem[] = [];
  const acroNames = new Set(template.acroformFields.map((field) => field.name));
  const onPage = (page: number | undefined, x: number | undefined, y: number | undefined, at: string) => {
    const box = page === undefined ? undefined : template.pages[page - 1];
    if (page === undefined || x === undefined || y === undefined) return;
    if (box === undefined) return void problems.push({ code: 'COORDINATE_OUT_OF_PAGE', path: at, detail: `page ${page}` });
    const size = displayedSize(box);
    if (x > size.width || y > size.height) problems.push({ code: 'COORDINATE_OUT_OF_PAGE', path: at, detail: `page ${page}` });
  };
  for (const [index, field] of mapping.fields.entries()) {
    const at = `fields[${index}]`;
    if (field.fieldCode !== undefined) {
      const found = scope.fields.get(field.fieldCode);
      if (found === undefined) problems.push({ code: 'DOCUMENT_FIELD_UNKNOWN', path: `${at}.fieldCode`, detail: field.fieldCode });
      else if (found.type === 'TABLE') problems.push({ code: 'DOCUMENT_FIELD_TYPE_MISMATCH', path: `${at}.fieldCode`, detail: 'a table cannot be placed in a PDF field' });
    }
    if (field.expression !== undefined) checkExpression(field.expression, `${at}.expression`, scope, undefined, false, problems);
    if (field.mode === 'ACROFORM' && field.acroformName !== undefined && !acroNames.has(field.acroformName)) problems.push({ code: 'ACROFORM_FIELD_UNKNOWN', path: `${at}.acroformName`, detail: field.acroformName });
    if (field.mode === 'COORDINATES') onPage(field.page, field.x, field.y, at);
  }
  for (const [index, slot] of mapping.signatures.entries()) {
    const at = `signatures[${index}]`;
    checkSlot(slot, at, scope, problems);
    if (slot.mode === 'ACROFORM' && slot.acroformName !== undefined && !acroNames.has(slot.acroformName)) problems.push({ code: 'ACROFORM_FIELD_UNKNOWN', path: `${at}.acroformName`, detail: slot.acroformName });
    if (slot.mode === 'COORDINATES') onPage(slot.page, slot.x, slot.y, at);
  }
  return problems;
}
