import { describe, expect, it } from 'vitest';
import { field } from '../../workflow/test-builders.js';
import { captureFieldsFor, validateCapturedValues } from './validate-captured-values.js';

const context = { today: '2026-10-05' };
const run = (fields: ReturnType<typeof field>[], input: Record<string, unknown>, existing: Record<string, unknown> = {}) => validateCapturedValues({ fields, input, existing, context });
const codes = (result: ReturnType<typeof run>) => result.issues.map((issue) => `${issue.fieldCode}:${issue.code}`);

describe('captureFieldsFor', () => {
  const fields = [field('a', 's1', 'A', { capture: 'CREATION' }), field('b', 's1', 'B', { capture: 'STEP' }), field('c', 's1', 'C', { capture: 'BOTH' }), field('d', 's2', 'D', { capture: 'BOTH' })];
  it('takes CREATION and BOTH at creation', () => expect(captureFieldsFor(fields, 'CREATION', 's1').map((f) => f.code)).toEqual(['A', 'C']));
  it('takes STEP and BOTH of the step when answering', () => expect(captureFieldsFor(fields, 'STEP', 's1').map((f) => f.code)).toEqual(['B', 'C']));
});

describe('validateCapturedValues', () => {
  it('requires required fields, counting stored values', () => {
    const required = field('a', 's', 'A', { isRequired: true });
    expect(codes(run([required], {}))).toEqual(['A:REQUIRED']);
    expect(codes(run([required], {}, { A: 'stored' }))).toEqual([]);
    expect(codes(run([required], { A: '   ' }))).toEqual(['A:REQUIRED']);
  });

  it('rejects codes the step does not capture', () => expect(codes(run([field('a', 's', 'A')], { OTHER: 'x' }))).toEqual(['OTHER:UNKNOWN_FIELD']));

  it('does not demand a read-only field', () => expect(codes(run([field('a', 's', 'A', { isReadOnly: true, isRequired: true })], {}))).toEqual([]));

  it('rejects values for read-only fields', () => expect(codes(run([field('a', 's', 'A', { isReadOnly: true })], { A: 'x' }))).toEqual(['A:NOT_EDITABLE']));

  it('ignores client values of computed fields', () => {
    const result = run([field('f', 's', 'F', { type: 'FORMULA' }), field('c', 's', 'C', { type: 'CALCULATOR' })], { F: 9999, C: 1 });
    expect(result.values).toEqual({});
    expect(result.issues).toEqual([]);
  });

  describe('numbers', () => {
    const amount = field('a', 's', 'AMOUNT', { type: 'CURRENCY', config: { min: 0, max: 5000 } });
    it('accepts numbers and plain decimal strings as numbers', () => {
      expect(run([amount], { AMOUNT: '1500.5' }).values).toEqual({ AMOUNT: 1500.5 });
      expect(run([amount], { AMOUNT: 20 }).values).toEqual({ AMOUNT: 20 });
    });
    it.each([
      ['1.500.000', 'INVALID_TYPE'],
      ['abc', 'INVALID_TYPE'],
      [10.123, 'TOO_MANY_DECIMALS'],
      [-1, 'OUT_OF_RANGE'],
      [5001, 'OUT_OF_RANGE'],
    ])('rejects %s', (value, code) => expect(codes(run([amount], { AMOUNT: value }))).toEqual([`AMOUNT:${code}`]));
    it('exponent notation does not hide decimals', () => expect(codes(run([field('n', 's', 'N', { type: 'NUMBER' })], { N: 1e-7 }))).toEqual(['N:TOO_MANY_DECIMALS']));
    it('honours decimals of NUMBER', () => expect(codes(run([field('n', 's', 'N', { type: 'NUMBER', config: { decimals: 1 } })], { N: 1.25 }))).toEqual(['N:TOO_MANY_DECIMALS']));
    it('needs whole numbers in DAYS', () => expect(codes(run([field('d', 's', 'D', { type: 'DAYS' })], { D: 1.5 }))).toEqual(['D:INVALID_TYPE']));
  });

  describe('text', () => {
    it('trims and bounds', () => {
      const text = field('t', 's', 'T', { config: { maxLength: 3 } });
      expect(run([text], { T: '  abc ' }).values).toEqual({ T: 'abc' });
      expect(codes(run([text], { T: 'abcd' }))).toEqual(['T:OUT_OF_RANGE']);
      expect(codes(run([text], { T: 4 }))).toEqual(['T:INVALID_TYPE']);
    });
  });

  describe('lists', () => {
    const options = { options: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }] };
    it('accepts only listed options', () => {
      const select = field('s', 's', 'S', { type: 'SELECT', config: options });
      expect(run([select], { S: 'A' }).values).toEqual({ S: 'A' });
      expect(codes(run([select], { S: 'Z' }))).toEqual(['S:NOT_AN_OPTION']);
    });
    it('deduplicates and bounds multi selects', () => {
      const multi = field('m', 's', 'M', { type: 'MULTI_SELECT', config: { ...options, maxSelected: 1 } });
      expect(run([multi], { M: ['A', 'A'] }).values).toEqual({ M: ['A'] });
      expect(codes(run([multi], { M: ['A', 'B'] }))).toEqual(['M:OUT_OF_RANGE']);
    });
    it('a preset value must be an id: anything else is a type error, not a database error', () => {
      const preset = field('p', 's', 'P', { type: 'SELECT', dataSource: { kind: 'PRESET', preset: 'SITES' } });
      expect(codes(run([preset], { P: 'abc' }))).toEqual(['P:INVALID_TYPE']);
    });
    it('asks the server to verify values from a data source', () => {
      const preset = field('p', 's', 'P', { type: 'SELECT', dataSource: { kind: 'PRESET', preset: 'SITES' } });
      const id = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
      const result = run([preset], { P: id });
      expect(result.references).toEqual([{ fieldCode: 'P', kind: 'PRESET', value: id, config: { preset: 'SITES' } }]);
    });
  });

  describe('dates', () => {
    it('accepts real days and resolves TODAY', () => {
      const date = field('d', 's', 'D', { type: 'DATE', config: { min: 'TODAY' } });
      expect(run([date], { D: '2026-10-05' }).values).toEqual({ D: '2026-10-05' });
      expect(codes(run([date], { D: '2026-10-04' }))).toEqual(['D:OUT_OF_RANGE']);
      expect(codes(run([date], { D: '2026-02-30' }))).toEqual(['D:INVALID_TYPE']);
    });
    it('normalizes date-times to UTC', () => {
      const result = run([field('d', 's', 'D', { type: 'DATETIME' })], { D: '2026-10-05T08:00:00-05:00' });
      expect(result.values).toEqual({ D: '2026-10-05T13:00:00.000Z' });
      expect(codes(run([field('d', 's', 'D', { type: 'DATETIME' })], { D: '2026-10-05 08:00' }))).toEqual(['D:INVALID_TYPE']);
    });
  });

  it('collects site and user references in lowercase', () => {
    const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const result = run([field('s', 's', 'SITE_F', { type: 'SITE' }), field('u', 's', 'USER_F', { type: 'USER' })], { SITE_F: id, USER_F: id });
    expect(result.references.map((reference) => [reference.kind, reference.value])).toEqual([['SITE', id.toLowerCase()], ['USER', id.toLowerCase()]]);
    expect(codes(run([field('s', 's', 'SITE_F', { type: 'SITE' })], { SITE_F: 'nope' }))).toEqual(['SITE_F:INVALID_TYPE']);
  });

  describe('tables', () => {
    const table = field('t', 's', 'ROWS', {
      type: 'TABLE',
      config: { columns: [{ code: 'KIND', label: 'Kind', type: 'TEXT', required: true }, { code: 'VALUE', label: 'Value', type: 'CURRENCY' }], minRows: 1, maxRows: 2 },
    });
    it('normalizes each cell with its column type', () => expect(run([table], { ROWS: [{ KIND: 'Food', VALUE: '10.50' }] }).values).toEqual({ ROWS: [{ KIND: 'Food', VALUE: 10.5 }] }));
    it('points at the failing cell', () => {
      const result = run([table], { ROWS: [{ KIND: 'Food', VALUE: 'x', EXTRA: 1 }, { VALUE: 1 }] });
      expect(result.issues).toEqual(
        expect.arrayContaining([
          { code: 'INVALID_TYPE', fieldCode: 'ROWS', row: 0, column: 'VALUE' },
          { code: 'UNKNOWN_FIELD', fieldCode: 'ROWS', row: 0, column: 'EXTRA' },
          { code: 'REQUIRED', fieldCode: 'ROWS', row: 1, column: 'KIND' },
        ]),
      );
    });
    it('bounds the number of rows', () => {
      expect(codes(run([table], { ROWS: [{ KIND: 'a' }, { KIND: 'b' }, { KIND: 'c' }] }))).toEqual(['ROWS:TOO_MANY_ROWS']);
    });
  });

  describe('file fields', () => {
    const [first, second] = ['0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90', '0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f91'];
    const files = field('f', 's', 'F', { type: 'FILE', config: { maxFiles: 2, accept: ['PDF'] } });

    it('keeps the ids, without repeats, and asks the server to verify each one', () => {
      const result = run([files], { F: [first, first.toUpperCase(), second] });
      expect(result.values).toEqual({ F: [first, second] });
      expect(result.references).toEqual([
        { fieldCode: 'F', kind: 'FILE', value: first, config: { accept: ['PDF'] } },
        { fieldCode: 'F', kind: 'FILE', value: second, config: { accept: ['PDF'] } },
      ]);
    });
    it('rejects more files than the field allows and values that are not a list of ids', () => {
      expect(codes(run([files], { F: [first, second, '0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f92'] }))).toEqual(['F:TOO_MANY_FILES']);
      expect(codes(run([files], { F: 'x' }))).toEqual(['F:INVALID_TYPE']);
      expect(codes(run([files], { F: ['not-an-id'] }))).toEqual(['F:INVALID_TYPE']);
    });
    it('counts an empty list as not answered', () => {
      const required = field('f', 's', 'F', { type: 'FILE', isRequired: true, config: { maxFiles: 1 } });
      expect(codes(run([required], { F: [] }))).toEqual(['F:REQUIRED']);
      expect(codes(run([required], { F: [] }, { F: [first] }))).toEqual([]);
    });
  });
});
