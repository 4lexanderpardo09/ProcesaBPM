import { FIELD_CODE_PATTERN, isAutomaticStep } from '../constants.js';
import { buildFormulaSchema, compileFormula, formulaResultType } from '../../engine/formulas/index.js';
import { checkFieldDataSource, parseFieldConfig } from '../field-config.js';
import { type RuleContext } from './context.js';

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

  const isComputed = (code: string): boolean => ['FORMULA', 'CALCULATOR'].includes(fieldByCode.get(code)?.type ?? '');
  const formulaSchema = buildFormulaSchema(doc.fields);
  const formulaRefs = new Map<string, string[]>();
  for (const field of doc.fields.filter((candidate) => candidate.type === 'FORMULA')) {
    const compiled = compileFormula(typeof field.config.expression === 'string' ? field.config.expression : '', formulaSchema);
    if (!compiled.ok) {
      const issue = compiled.issues[0]!;
      const code = issue.code === 'UNKNOWN_FIELD' ? 'FORMULA_UNKNOWN_FIELD' : 'FORMULA_INVALID';
      problems.error(code, { fieldId: field.id, params: { issue: issue.code, position: issue.position, detail: issue.detail ?? '' } });
      formulaRefs.set(field.code, []);
      continue;
    }
    if (compiled.formula.type !== formulaResultType(field)) {
      problems.error('FORMULA_RESULT_TYPE_MISMATCH', { fieldId: field.id, params: { declared: formulaResultType(field), actual: compiled.formula.type } });
    }
    formulaRefs.set(field.code, compiled.formula.references.filter(isComputed));
  }
  for (const field of doc.fields.filter((candidate) => candidate.type === 'CALCULATOR')) {
    formulaRefs.set(field.code, Object.values((field.config.inputs ?? {}) as Record<string, string>).filter(isComputed));
  }
  // Depth-first colouring (white, grey = on the current path, black = done): linear in fields and references.
  const inCycle = new Set<string>();
  const state = new Map<string, 'grey' | 'black'>();
  const visit = (code: string, path: string[]): void => {
    state.set(code, 'grey');
    path.push(code);
    for (const next of formulaRefs.get(code) ?? []) {
      if (state.get(next) === 'grey') for (const member of path.slice(path.indexOf(next))) inCycle.add(member);
      else if (!state.has(next)) visit(next, path);
    }
    path.pop();
    state.set(code, 'black');
  };
  for (const code of formulaRefs.keys()) if (!state.has(code)) visit(code, []);
  for (const code of inCycle) problems.error('FORMULA_CYCLE', { fieldId: fieldByCode.get(code)!.id, params: { code } });
}
