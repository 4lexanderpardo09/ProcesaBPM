import { describe, expect, it } from 'vitest';
import type { FieldDocument } from '../../workflow/document.js';
import { computeFormulaValues } from './compute-field-values.js';
import { FormulaRuntimeError, evaluateFormulaExpression } from './evaluate.js';
import { compileFormula } from './parser.js';
import { buildFormulaSchema } from './schema.js';
import { FORMULA_LIMITS, type FormulaSchema } from './types.js';

const schema: FormulaSchema = {
  fields: new Map([
    ['PRICE', { kind: 'value', type: 'NUMBER' }],
    ['QTY', { kind: 'value', type: 'NUMBER' }],
    ['NAME', { kind: 'value', type: 'TEXT' }],
    ['START', { kind: 'value', type: 'DATE' }],
    ['ITEMS', { kind: 'table', columns: new Map([['AMOUNT', 'NUMBER'], ['LABEL', 'TEXT']]) }],
  ]),
};
const context = { today: '2026-10-02' };

function run(source: string, values: Record<string, unknown> = {}, extra: Partial<typeof context> & { isBusinessDay?: (d: string) => boolean } = {}): unknown {
  const compiled = compileFormula(source, schema);
  if (!compiled.ok) throw new Error(`compile ${JSON.stringify(compiled.issues)}`);
  const result = evaluateFormulaExpression(compiled.formula.expression, { ...context, ...extra, values });
  return result !== null && typeof result === 'object' ? result.toPlainString() : result;
}
const issueOf = (source: string) => {
  const compiled = compileFormula(source, schema);
  return compiled.ok ? undefined : compiled.issues[0]!.code;
};

describe('formula arithmetic', () => {
  it('is exact and respects precedence', () => {
    expect(run('0.1 + 0.2')).toBe('0.3');
    expect(run('2 + 3 * 4')).toBe('14');
    expect(run('(2 + 3) * 4')).toBe('20');
    expect(run('-PRICE * QTY', { PRICE: 10.5, QTY: 3 })).toBe('-31.5');
    expect(run('7 % 3')).toBe('1');
    expect(run('1 / 3')).toBe('0.333333333333');
  });

  it('propagates an empty value instead of treating it as zero', () => {
    expect(run('PRICE * QTY', { PRICE: 10 })).toBeNull();
    expect(run('ISBLANK(QTY)', { PRICE: 10 })).toBe(true);
    expect(run('IF(PRICE > 5, "big", "small")', {})).toBe('small');
  });

  it('fails on division by zero, and IFERROR recovers', () => {
    expect(() => run('1 / QTY', { QTY: 0 })).toThrow(FormulaRuntimeError);
    expect(run('IFERROR(1 / QTY, 0)', { QTY: 0 })).toBe('0');
  });

  it('refuses numbers that grow without bound', () => {
    expect(() => run('999999999999 * 999999999999')).toThrowError(expect.objectContaining({ code: 'NUMBER_OVERFLOW' }));
  });

  it('reads decimal strings stored as text', () => {
    expect(run('PRICE + 1', { PRICE: '1234567.89' })).toBe('1234568.89');
    expect(() => run('PRICE + 1', { PRICE: 'abc' })).toThrowError(expect.objectContaining({ code: 'INVALID_VALUE' }));
  });
});

describe('formula functions', () => {
  it('rounds half up or toward zero', () => {
    expect(run('ROUND(2.345, 2)')).toBe('2.35');
    expect(run('ROUND(-2.5)')).toBe('-3');
    expect(run('ROUNDDOWN(2.999, 2)')).toBe('2.99');
  });

  it('aggregates table columns ignoring empty cells', () => {
    const values = { ITEMS: [{ AMOUNT: 10 }, { AMOUNT: 5.5 }, {}] };
    expect(run('SUM(ITEMS.AMOUNT)', values)).toBe('15.5');
    expect(run('COUNT(ITEMS.AMOUNT)', values)).toBe('2');
    expect(run('AVG(ITEMS.AMOUNT)', values)).toBe('7.75');
    expect(run('MAX(ITEMS.AMOUNT)', values)).toBe('10');
    expect(run('SUM(ITEMS.AMOUNT)', {})).toBe('0');
    expect(run('AVG(ITEMS.AMOUNT)', {})).toBeNull();
  });

  it('works with text', () => {
    expect(run('CONCAT(NAME, " #", QTY)', { NAME: 'Ana', QTY: 3 })).toBe('Ana #3');
    expect(run('UPPER(TRIM(NAME))', { NAME: ' ana ' })).toBe('ANA');
    expect(run('LEN(LEFT(NAME, 2))', { NAME: 'Ana' })).toBe('2');
  });

  it('works with dates', () => {
    expect(run('ADD_DAYS(START, 30)', { START: '2026-01-15' })).toBe('2026-02-14');
    expect(run('DAYS_BETWEEN(START, TODAY())', { START: '2026-09-02' })).toBe('30');
    expect(run('YEAR(START) * 100 + MONTH(START)', { START: '2026-09-02' })).toBe('202609');
    expect(run('START < TODAY()', { START: '2026-09-02' })).toBe(true);
  });

  it('skips weekends and the holidays of the calendar', () => {
    expect(run('ADD_BUSINESS_DAYS(START, 1)', { START: '2026-10-02' })).toBe('2026-10-05');
    expect(run('ADD_BUSINESS_DAYS(START, 1)', { START: '2026-10-02' }, { isBusinessDay: (date) => date !== '2026-10-05' && ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) })).toBe('2026-10-06');
    expect(() => run('ADD_DAYS(START, 100000000)', { START: '2026-01-01' })).toThrow(FormulaRuntimeError);
  });

  it('evaluates IF lazily', () => {
    expect(run('IF(QTY = 0, 0, 10 / QTY)', { QTY: 0 })).toBe('0');
  });
});

describe('formula compilation', () => {
  it('reports typed errors with a position', () => {
    expect(issueOf('PRICE +')).toBe('SYNTAX');
    expect(issueOf('MISSING + 1')).toBe('UNKNOWN_FIELD');
    expect(issueOf('NOPE(1)')).toBe('UNKNOWN_FUNCTION');
    expect(issueOf('ROUND()')).toBe('WRONG_ARGUMENT_COUNT');
    expect(issueOf('NAME + 1')).toBe('TYPE_MISMATCH');
    expect(issueOf('START + 1')).toBe('TYPE_MISMATCH');
    expect(issueOf('ITEMS.NOPE')).toBe('UNKNOWN_COLUMN');
    expect(issueOf('ITEMS.AMOUNT + 1')).toBe('LIST_OUTSIDE_AGGREGATE');
    expect(issueOf('SUM(PRICE)')).toBe('TYPE_MISMATCH');
    expect(issueOf('IF(PRICE, 1, 2)')).toBe('TYPE_MISMATCH');
    expect(issueOf('IF(PRICE > 1, 1, "x")')).toBe('TYPE_MISMATCH');
    expect(issueOf('1 +')).toBe('SYNTAX');
    expect(issueOf('"open')).toBe('SYNTAX');
    expect(issueOf('1 ; 2')).toBe('SYNTAX');
  });

  it('collects the fields it reads', () => {
    const result = compileFormula('SUM(ITEMS.AMOUNT) * PRICE + PRICE', schema);
    expect(result.ok && [...result.formula.references].sort()).toEqual(['ITEMS', 'PRICE']);
    expect(result.ok && result.formula.type).toBe('NUMBER');
  });

  it('bounds length, depth and size', () => {
    expect(issueOf('1+'.repeat(FORMULA_LIMITS.sourceLength) + '1')).toBe('TOO_LONG');
    expect(issueOf('('.repeat(40) + '1' + ')'.repeat(40))).toBe('TOO_DEEP');
    expect(issueOf(Array.from({ length: 450 }, () => '1').join('+'))).toBe('TOO_COMPLEX');
  });

  it('never executes code: identifiers are only fields or whitelisted functions', () => {
    expect(issueOf('constructor')).toBe('UNKNOWN_FIELD');
    expect(issueOf('process.exit(1)')).toBe('UNKNOWN_FIELD');
    expect(issueOf('__proto__')).toBe('UNKNOWN_FIELD');
    expect(issueOf('toString(1)')).toBe('UNKNOWN_FUNCTION');
  });
});

function field(partial: Partial<FieldDocument> & Pick<FieldDocument, 'code' | 'type'>): FieldDocument {
  return { id: partial.code, stepId: 'S', label: partial.code, capture: 'STEP', isRequired: false, isReadOnly: false, sortOrder: 0, config: {}, dataSource: null, ...partial } as FieldDocument;
}

describe('computeFormulaValues', () => {
  const fields = [
    field({ code: 'PRICE', type: 'CURRENCY' }),
    field({ code: 'QTY', type: 'NUMBER' }),
    field({ code: 'TOTAL', type: 'FORMULA', config: { expression: 'SUBTOTAL * 1.19', resultType: 'CURRENCY' } }),
    field({ code: 'SUBTOTAL', type: 'FORMULA', config: { expression: 'PRICE * QTY', resultType: 'CURRENCY' } }),
    field({ code: 'DUE', type: 'FORMULA', config: { expression: 'ADD_DAYS(TODAY(), QTY)', resultType: 'DATE' } }),
    field({ code: 'BAD', type: 'FORMULA', config: { expression: 'PRICE / (QTY - QTY)', resultType: 'NUMBER' } }),
    field({ code: 'LOOP_A', type: 'FORMULA', config: { expression: 'LOOP_B + 1', resultType: 'NUMBER' } }),
    field({ code: 'LOOP_B', type: 'FORMULA', config: { expression: 'LOOP_A + 1', resultType: 'NUMBER' } }),
    field({ code: 'WRONG', type: 'FORMULA', config: { expression: '"text"', resultType: 'NUMBER' } }),
  ];

  it('computes dependencies first and rounds to the declared decimals', () => {
    const result = computeFormulaValues(fields, { PRICE: 100.5, QTY: 3 }, context);
    expect(result.values).toMatchObject({ SUBTOTAL: 301.5, TOTAL: 358.79, DUE: '2026-10-05' });
  });

  it('reports failures, cycles and mistyped formulas without throwing', () => {
    const result = computeFormulaValues(fields, { PRICE: 100.5, QTY: 3 }, context);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        { fieldCode: 'BAD', reason: 'DIVISION_BY_ZERO' },
        { fieldCode: 'LOOP_A', reason: 'CYCLE' },
        { fieldCode: 'LOOP_B', reason: 'CYCLE' },
        { fieldCode: 'WRONG', reason: 'INVALID_FORMULA' },
      ]),
    );
    expect(result.values.BAD).toBeNull();
  });

  it('yields null when an input is missing and ignores client-sent values of computed fields', () => {
    const result = computeFormulaValues(fields, { PRICE: 100, TOTAL: 1 }, context);
    expect(result.values.SUBTOTAL).toBeNull();
    expect(result.values.TOTAL).toBeNull();
  });

  it('builds the schema only from field types a formula understands', () => {
    const built = buildFormulaSchema([field({ code: 'PIC', type: 'FILE' }), field({ code: 'AMT', type: 'CURRENCY' })]);
    expect([...built.fields.keys()]).toEqual(['AMT']);
  });
});
