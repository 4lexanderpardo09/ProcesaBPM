import { findCalculator } from '../../calculators/registry.js';
import type { CalculatorInputType } from '../../calculators/types.js';
import type { FieldDocument } from '../document.js';
import { effectiveFieldType } from '../transition-condition.js';
import { type RuleContext } from './context.js';

const INPUT_FIELD_TYPES: Readonly<Record<CalculatorInputType, ReadonlySet<string>>> = {
  DATETIME: new Set(['DATETIME']),
  DATE: new Set(['DATE']),
  NUMBER: new Set(['NUMBER', 'CURRENCY', 'DAYS']),
  TEXT: new Set(['TEXT', 'TEXTAREA', 'SELECT']),
};
const OUTPUT_FIELD_TYPES: ReadonlySet<string> = new Set(['NUMBER', 'CURRENCY']);

/** A calculator use (a CALCULATOR field or block) names a built-in calculator and wires its inputs to fields of the version. */
function checkUse(context: RuleContext, at: Record<string, string>, calculatorCode: string, inputs: Readonly<Record<string, string>>): void {
  const { problems, fieldByCode } = context;
  const calculator = findCalculator(calculatorCode);
  if (calculator === undefined) {
    problems.error('CALCULATOR_UNKNOWN', { ...at, params: { code: calculatorCode } });
    return;
  }
  const parameters = new Map(calculator.parameters.map((parameter) => [parameter.name, parameter]));
  for (const name of Object.keys(inputs)) if (!parameters.has(name)) problems.error('CALCULATOR_INPUT_UNKNOWN', { ...at, params: { name } });
  for (const parameter of calculator.parameters) {
    const code = inputs[parameter.name];
    if (code === undefined) {
      if (parameter.required) problems.error('CALCULATOR_INPUT_MISSING', { ...at, params: { name: parameter.name } });
      continue;
    }
    const field = fieldByCode.get(code);
    if (field !== undefined && !INPUT_FIELD_TYPES[parameter.type].has(effectiveFieldType(field))) {
      problems.error('CALCULATOR_INPUT_TYPE_MISMATCH', { ...at, params: { name: parameter.name, code, expected: parameter.type } });
    }
  }
}

const isPlainOutput = (field: FieldDocument): boolean => OUTPUT_FIELD_TYPES.has(field.type);

/** CALCULATOR fields and blocks. Whether the tenant switched the calculator on is checked by the API (it needs the tenant's data). */
export function checkCalculators(context: RuleContext): void {
  const { doc, problems, fieldByCode } = context;
  for (const field of doc.fields.filter((candidate) => candidate.type === 'CALCULATOR')) {
    checkUse(context, { fieldId: field.id }, String(field.config.calculatorCode ?? ''), (field.config.inputs ?? {}) as Record<string, string>);
  }
  for (const step of doc.steps.filter((candidate) => candidate.type === 'CALCULATOR')) {
    const config = step.config as { calculatorCode?: string; inputs?: Record<string, string>; outputFieldCode?: string };
    if (typeof config.calculatorCode !== 'string' || config.inputs === undefined || config.outputFieldCode === undefined) continue;
    const at = { stepId: step.id };
    checkUse(context, at, config.calculatorCode, config.inputs);
    const output = fieldByCode.get(config.outputFieldCode);
    if (output === undefined) continue;
    if (!isPlainOutput(output)) problems.error('CALCULATOR_OUTPUT_TYPE_MISMATCH', { ...at, params: { code: output.code } });
    else if (!output.isReadOnly) problems.error('CALCULATOR_OUTPUT_NOT_READ_ONLY', { ...at, params: { code: output.code } });
  }
}
