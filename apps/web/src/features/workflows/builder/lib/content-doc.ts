import { type AmountRuleDocument, FIELD_CODE_PATTERN, type FieldDocument, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { StepChildren } from '../api/draft-content-api';

export function upsertField(doc: WorkflowVersionDocument, field: FieldDocument): WorkflowVersionDocument {
  const exists = doc.fields.some((candidate) => candidate.id === field.id);
  return { ...doc, fields: exists ? doc.fields.map((candidate) => (candidate.id === field.id ? field : candidate)) : [...doc.fields, field] };
}

export function removeField(doc: WorkflowVersionDocument, fieldId: string): WorkflowVersionDocument {
  return { ...doc, fields: doc.fields.filter((field) => field.id !== fieldId) };
}

export function setStepChildren(doc: WorkflowVersionDocument, stepId: string, children: StepChildren): WorkflowVersionDocument {
  return { ...doc, steps: doc.steps.map((step) => (step.id === stepId ? { ...step, ...children } : step)) };
}

export function upsertAmountRule(doc: WorkflowVersionDocument, rule: AmountRuleDocument): WorkflowVersionDocument {
  const exists = doc.amountRules.some((candidate) => candidate.id === rule.id);
  return { ...doc, amountRules: exists ? doc.amountRules.map((candidate) => (candidate.id === rule.id ? rule : candidate)) : [...doc.amountRules, rule] };
}

export function removeAmountRule(doc: WorkflowVersionDocument, ruleId: string): WorkflowVersionDocument {
  return { ...doc, amountRules: doc.amountRules.filter((rule) => rule.id !== ruleId) };
}

/** The fields of a block in the order the form shows them. */
export function fieldsOf(doc: WorkflowVersionDocument, stepId: string): FieldDocument[] {
  return doc.fields.filter((field) => field.stepId === stepId).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es'));
}

const CODE_MAX = 100;

/**
 * The code a label suggests: upper snake case without accents ("Monto total" → MONTO_TOTAL), starting with a letter, and
 * not one the version already has (MONTO_TOTAL_2). Conditions, formulas and PDFs refer to fields by it.
 */
export function codeFromLabel(label: string, taken: ReadonlySet<string>): string {
  let base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base === '') return '';
  if (!/^[A-Z]/.test(base)) base = `F_${base}`;
  base = base.slice(0, CODE_MAX - 4);
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${String(index)}`)) index += 1;
  return `${base}_${String(index)}`;
}

export const isFieldCode = (code: string): boolean => FIELD_CODE_PATTERN.test(code);
