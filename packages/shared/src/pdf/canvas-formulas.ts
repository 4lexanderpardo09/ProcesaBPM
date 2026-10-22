import { compileFormula } from '../engine/formulas/parser.js';
import { buildFormulaSchema } from '../engine/formulas/schema.js';
import type { CompiledFormula, FormulaFieldShape, FormulaSchema } from '../engine/formulas/types.js';
import type { FieldDocument } from '../workflow/document.js';
import type { PdfCanvasDesign } from './canvas-schema.js';

export interface CanvasFormulaProblem {
  readonly code: 'DOCUMENT_FORMULA_INVALID' | 'DOCUMENT_CALCULATION_CODE_TAKEN';
  readonly path: string;
  readonly detail?: string;
}

export interface CompiledCanvasFormulas {
  /** In the design's order; a calculation reads the fields and the calculations above it. */
  readonly calculations: ReadonlyArray<{ readonly code: string; readonly decimals: number; readonly formula: CompiledFormula }>;
  /** Conditions by element id and by sheet index; an empty condition is not here (always printed). */
  readonly elementConditions: ReadonlyMap<string, CompiledFormula>;
  readonly sheetConditions: ReadonlyMap<number, CompiledFormula>;
  readonly problems: readonly CanvasFormulaProblem[];
}

/**
 * Compiles the calculations and conditions of a canvas against the fields of a workflow version. A calculation is a
 * number, text or date and is read by later formulas as a field of that type; a condition must be true or false. A
 * formula that does not compile is reported and left out (the element then always prints, the calculation is empty).
 */
export function compileCanvasFormulas(design: PdfCanvasDesign, fields: readonly FieldDocument[]): CompiledCanvasFormulas {
  const problems: CanvasFormulaProblem[] = [];
  const shapes = new Map<string, FormulaFieldShape>(buildFormulaSchema(fields).fields);
  const fieldCodes = new Set(fields.map((field) => field.code));
  const calculations: Array<{ code: string; decimals: number; formula: CompiledFormula }> = [];
  const describe = (issues: ReadonlyArray<{ code: string; position: number; detail?: string }>) => issues.map((issue) => `${issue.code}${issue.detail === undefined ? '' : ` ${issue.detail}`} @${issue.position}`).join('; ');

  design.calculations.forEach((calculation, index) => {
    const at = `calculations[${index}]`;
    if (fieldCodes.has(calculation.code)) problems.push({ code: 'DOCUMENT_CALCULATION_CODE_TAKEN', path: `${at}.code`, detail: calculation.code });
    const compiled = compileFormula(calculation.formula, { fields: new Map(shapes) } satisfies FormulaSchema);
    if (!compiled.ok) return void problems.push({ code: 'DOCUMENT_FORMULA_INVALID', path: `${at}.formula`, detail: describe(compiled.issues) });
    if (compiled.formula.type === 'BOOLEAN') return void problems.push({ code: 'DOCUMENT_FORMULA_INVALID', path: `${at}.formula`, detail: 'TYPE_MISMATCH a calculation is a number, a text or a date' });
    calculations.push({ code: calculation.code, decimals: calculation.decimals, formula: compiled.formula });
    shapes.set(calculation.code, { kind: 'value', type: compiled.formula.type });
  });

  const schema: FormulaSchema = { fields: shapes };
  const condition = (source: string, at: string): CompiledFormula | undefined => {
    if (source.trim() === '') return undefined;
    const compiled = compileFormula(source, schema);
    if (!compiled.ok) return void problems.push({ code: 'DOCUMENT_FORMULA_INVALID', path: at, detail: describe(compiled.issues) });
    if (compiled.formula.type !== 'BOOLEAN') return void problems.push({ code: 'DOCUMENT_FORMULA_INVALID', path: at, detail: 'TYPE_MISMATCH a condition is true or false' });
    return compiled.formula;
  };
  const elementConditions = new Map<string, CompiledFormula>();
  design.elements.forEach((element, index) => {
    const compiled = condition(element.condition, `elements[${index}].condition`);
    if (compiled !== undefined) elementConditions.set(element.id, compiled);
  });
  const sheetConditions = new Map<number, CompiledFormula>();
  design.sheets.forEach((sheet, index) => {
    const compiled = condition(sheet.condition, `sheets[${index}].condition`);
    if (compiled !== undefined) sheetConditions.set(index, compiled);
  });
  return { calculations, elementConditions, sheetConditions, problems };
}
