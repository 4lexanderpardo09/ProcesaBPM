import type { AmountRuleDocument, FieldDocument } from '../../workflow/document.js';
import { exceeds, toScaledInteger } from '../money/decimal.js';

export interface AmountScope {
  /** The step being submitted (START when the ticket is created). */
  readonly stepId: string;
  readonly companyId: string;
  /** Position of the person submitting; `null` when they have none. */
  readonly positionId: string | null;
  /** Currency of the company: fields without their own currency use it. */
  readonly companyCurrency: string;
}

export interface AmountWarning {
  readonly ruleId: string;
  readonly amount: string;
  readonly max: string;
  readonly message: string | null;
}

export interface AmountEvaluation {
  readonly blocks: readonly string[];
  readonly warnings: readonly AmountWarning[];
  /** The EXTRA_APPROVAL rule that sends the ticket to an extra approval step (the highest exceeded cap wins). */
  readonly diversion: AmountRuleDocument | undefined;
}

const normalizeText = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/** Total of the field in scaled integer units, or `undefined` when there is nothing to measure. */
function measure(rule: AmountRuleDocument, field: FieldDocument, values: Readonly<Record<string, unknown>>): bigint | undefined {
  const value = values[rule.fieldCode];
  if (value === undefined || value === null) return undefined;
  if (field.type !== 'TABLE') return typeof value === 'number' || typeof value === 'string' ? toScaledInteger(value) : undefined;
  if (!Array.isArray(value) || rule.amountColumn === null) return undefined;
  let total = 0n;
  for (const row of value as Array<Record<string, unknown>>) {
    const matches = rule.typeColumn === null || normalizeText(row[rule.typeColumn]) === normalizeText(rule.rowTypeValue);
    const cell = row[rule.amountColumn];
    if (matches && (typeof cell === 'number' || typeof cell === 'string')) total += toScaledInteger(cell) ?? 0n;
  }
  return total;
}

const formatScaled = (scaled: bigint): string => {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(7, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -6)}.${digits.slice(-6).replace(/0+$/, '').padEnd(2, '0')}`;
};

function applies(rule: AmountRuleDocument, field: FieldDocument, scope: AmountScope): boolean {
  if (!rule.isActive) return false;
  if (rule.stepId !== null && rule.stepId !== scope.stepId) return false;
  if (rule.companyId !== null && rule.companyId !== scope.companyId) return false;
  if (rule.positionId !== null && rule.positionId !== scope.positionId) return false;
  const configured = field.config.currencyCode;
  return rule.currencyCode === (typeof configured === 'string' ? configured : scope.companyCurrency);
}

/**
 * Caps on amounts for one submission (docs/analisis §8). Rules of the submitted step, of the ticket's company
 * and of the submitter's position apply; a rule in another currency does not (there is no conversion).
 * Precedence: any BLOCK stops the operation, otherwise EXTRA_APPROVAL diverts, WARN only notes.
 */
export function evaluateAmountRules(rules: readonly AmountRuleDocument[], fields: ReadonlyMap<string, FieldDocument>, values: Readonly<Record<string, unknown>>, scope: AmountScope): AmountEvaluation {
  const blocks: string[] = [];
  const warnings: AmountWarning[] = [];
  let diversion: AmountRuleDocument | undefined;
  for (const rule of rules) {
    const field = fields.get(rule.fieldCode);
    if (field === undefined || !applies(rule, field, scope)) continue;
    const amount = measure(rule, field, values);
    if (amount === undefined || !exceeds(formatScaled(amount), rule.maxAmount)) continue;
    if (rule.action === 'BLOCK') blocks.push(rule.message ?? `The amount of ${rule.fieldCode} exceeds ${rule.maxAmount}`);
    else if (rule.action === 'WARN') warnings.push({ ruleId: rule.id, amount: formatScaled(amount), max: rule.maxAmount, message: rule.message });
    else if (diversion === undefined || exceeds(rule.maxAmount, diversion.maxAmount) || (!exceeds(diversion.maxAmount, rule.maxAmount) && rule.id < diversion.id)) diversion = rule;
  }
  return { blocks, warnings, diversion };
}
