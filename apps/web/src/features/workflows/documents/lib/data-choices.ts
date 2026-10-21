import type { FieldDocument, WorkflowVersionDocument } from '@procesabpm/shared';

/** One piece of data a text can show: what the person reads, and the placeholder that goes into the text. */
export interface DataChoice {
  readonly group: 'ticket' | 'fields' | 'steps' | 'row' | 'other';
  /** A key of `documents.designer.data.*`, or the field's own label. */
  readonly label: { readonly key: string; readonly values?: { readonly column?: string; readonly step?: string } } | { readonly text: string };
  readonly placeholder: string;
}

const TICKET: readonly [string, string][] = [
  ['number', '{{ticket.number}}'],
  ['title', '{{ticket.title}}'],
  ['status', '{{ticket.status}}'],
  ['createdAt', '{{ticket.createdAt|date}}'],
  ['closedAt', '{{ticket.closedAt|date}}'],
  ['companyName', '{{ticket.companyName}}'],
  ['creatorName', '{{ticket.creatorName}}'],
  ['currentStepName', '{{ticket.currentStepName}}'],
];

/** How each kind of value reads best in a document. */
const FORMATTER: Readonly<Partial<Record<string, string>>> = { CURRENCY: '|currency', DATE: '|date', DATETIME: '|datetime', NUMBER: '|number', DAYS: '|number' };

const PEOPLE_STEPS: ReadonlySet<string> = new Set(['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE']);
/** A name a placeholder can carry (the language reads `.`, `|` and braces as its own). */
const NAMEABLE_STEP = /^[^.|{}]{1,100}$/;

export const tableColumnsOf = (field: FieldDocument): { code: string; label: string }[] =>
  Array.isArray(field.config['columns']) ? (field.config['columns'] as Array<{ code?: unknown; label?: unknown }>).flatMap((column) => (typeof column.code === 'string' ? [{ code: column.code, label: typeof column.label === 'string' ? column.label : column.code }] : [])) : [];

/**
 * What can be inserted where: the ticket, its fields (a table goes in a table block), who finished each step and when;
 * the page numbers only in the header and footer; and inside a table block, the columns of its row.
 */
export function dataChoices(document: WorkflowVersionDocument, where: { readonly inBand: boolean; readonly table?: FieldDocument | undefined }): DataChoice[] {
  const choices: DataChoice[] = TICKET.map(([name, placeholder]) => ({ group: 'ticket', label: { key: `ticket.${name}` }, placeholder }));
  if (where.table !== undefined) {
    const row: DataChoice[] = tableColumnsOf(where.table).map((column) => ({ group: 'row', label: { key: 'row', values: { column: column.label } }, placeholder: `{{row.${column.code}}}` }));
    choices.unshift(...row);
  }
  for (const field of document.fields) {
    if (field.type === 'TABLE') continue;
    choices.push({ group: 'fields', label: { text: field.label }, placeholder: `{{field.${field.code}${FORMATTER[field.type] ?? ''}}}` });
  }
  for (const step of document.steps) {
    if (!PEOPLE_STEPS.has(step.type) || !NAMEABLE_STEP.test(step.name)) continue;
    choices.push({ group: 'steps', label: { key: 'completedBy', values: { step: step.name } }, placeholder: `{{step.${step.name}.completedBy}}` });
    choices.push({ group: 'steps', label: { key: 'completedAt', values: { step: step.name } }, placeholder: `{{step.${step.name}.completedAt|datetime}}` });
  }
  choices.push({ group: 'other', label: { key: 'now' }, placeholder: '{{now|datetime}}' });
  if (where.inBand) {
    choices.push({ group: 'other', label: { key: 'page' }, placeholder: '{{page}}' });
    choices.push({ group: 'other', label: { key: 'pages' }, placeholder: '{{pages}}' });
  }
  return choices;
}

/** Steps a person attends: a signature box needs someone to sign. */
export const signingSteps = (document: WorkflowVersionDocument) => document.steps.filter((step) => PEOPLE_STEPS.has(step.type));
