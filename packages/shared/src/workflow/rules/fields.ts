import { FIELD_CODE_PATTERN, isAutomaticStep } from '../constants.js';
import { checkFieldDataSource, parseFieldConfig } from '../field-config.js';
import { type RuleContext } from './context.js';

/** Upper-case words that are not followed by `(`: field codes (a call such as SUM(...) is a function). */
const FORMULA_TOKEN = /\b[A-Z][A-Z0-9_]*\b(?!\s*\()/g;

/** Field codes, where fields live, their `config` and data source, and formula references. */
export function checkFields({ doc, stepById, fieldByCode, problems }: RuleContext): void {
  const seen = new Set<string>();
  for (const field of doc.fields) {
    const at = { fieldId: field.id };
    if (seen.has(field.code)) problems.error('FIELD_CODE_DUPLICATE', { ...at, params: { code: field.code } });
    seen.add(field.code);
    if (!FIELD_CODE_PATTERN.test(field.code)) problems.error('FIELD_CODE_INVALID', { ...at, params: { code: field.code } });

    const step = stepById.get(field.stepId);
    if (step === undefined) problems.error('FIELD_UNKNOWN_STEP', at);
    else {
      if (isAutomaticStep(step.type) && step.type !== 'START') problems.error('FIELD_ON_AUTOMATIC_BLOCK', { ...at, stepId: step.id });
      if (field.capture === 'CREATION' && step.type !== 'START') problems.error('FIELD_CREATION_CAPTURE_NOT_ON_START', { ...at, stepId: step.id });
    }

    const config = parseFieldConfig(field.type, field.config, field.dataSource);
    if (!config.valid) problems.error('FIELD_CONFIG_INVALID', { ...at, params: { issues: config.issues } });
    const dataSource = checkFieldDataSource(field.type, field.dataSource);
    if (!dataSource.valid) problems.error('FIELD_DATA_SOURCE_INVALID', { ...at, params: { issues: dataSource.issues } });
  }

  const formulaRefs = new Map<string, string[]>();
  for (const field of doc.fields.filter((candidate) => candidate.type === 'FORMULA')) {
    const expression = typeof field.config.expression === 'string' ? field.config.expression : '';
    const refs = [...new Set(expression.match(FORMULA_TOKEN) ?? [])];
    const unknown = refs.filter((token) => !fieldByCode.has(token));
    if (unknown.length > 0) problems.error('FORMULA_UNKNOWN_FIELD', { fieldId: field.id, params: { codes: unknown } });
    formulaRefs.set(field.code, refs.filter((token) => fieldByCode.get(token)?.type === 'FORMULA'));
  }
  const inCycle = new Set<string>();
  const visit = (code: string, path: readonly string[]): void => {
    if (path.includes(code)) {
      for (const member of path.slice(path.indexOf(code))) inCycle.add(member);
      return;
    }
    for (const next of formulaRefs.get(code) ?? []) visit(next, [...path, code]);
  };
  for (const code of formulaRefs.keys()) visit(code, []);
  for (const code of inCycle) problems.error('FORMULA_CYCLE', { fieldId: fieldByCode.get(code)!.id, params: { code } });
}
