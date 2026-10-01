import { describe, expect, it } from 'vitest';
import { parseBlockConfig } from './block-config.js';
import { checkFieldDataSource, parseFieldConfig } from './field-config.js';
import { operatorAppliesTo, transitionConditionSchema } from './transition-condition.js';

const UUID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';

describe('block config', () => {
  it('applies defaults and rejects unknown keys', () => {
    expect(parseBlockConfig('APPROVAL', {})).toEqual({ valid: true, config: { rejectRequiresComment: true } });
    expect(parseBlockConfig('WEBHOOK', { webhookId: UUID })).toEqual({ valid: true, config: { webhookId: UUID, timeoutMs: 10_000, maxRetries: 3 } });
    expect(parseBlockConfig('START', { surprise: 1 }).valid).toBe(false);
  });

  it('checks each block type', () => {
    expect(parseBlockConfig('SIGNATURE', {}).valid).toBe(false);
    expect(parseBlockConfig('SIGNATURE', { document: 'MAIN_DOCUMENT' }).valid).toBe(true);
    expect(parseBlockConfig('DOCUMENT', { workflowDocumentId: UUID, role: 'STEP_DOCUMENT' }).valid).toBe(true);
    expect(parseBlockConfig('NOTIFICATION', { recipients: [], channels: ['EMAIL'], subject: 's', body: 'b' }).valid).toBe(false);
    expect(parseBlockConfig('NOTIFICATION', { recipients: [{ kind: 'USER', id: UUID }], channels: ['SMS'], subject: 's', body: 'b' }).valid).toBe(false);
    expect(parseBlockConfig('WAIT', { mode: 'COMPANY_CUTOFF' }).valid).toBe(true);
    expect(parseBlockConfig('WAIT', { mode: 'DURATION', value: 1 }).valid).toBe(false);
    expect(parseBlockConfig('TASK', { batch: { maxTickets: 1000 } }).valid).toBe(false);
  });
});

describe('field config', () => {
  it('requires options or a data source for lists, and unique option values', () => {
    expect(parseFieldConfig('SELECT', {}, null).valid).toBe(false);
    expect(parseFieldConfig('SELECT', {}, { kind: 'PRESET', preset: 'USERS' }).valid).toBe(true);
    expect(parseFieldConfig('SELECT', { options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] }, null).valid).toBe(false);
  });

  it('caps text sizes, table columns and files, and refuses user regexes', () => {
    expect(parseFieldConfig('TEXT', { maxLength: 5000 }, null).valid).toBe(false);
    expect(parseFieldConfig('TEXT', { pattern: '.*' }, null).valid).toBe(false);
    expect(parseFieldConfig('TABLE', { columns: [] }, null).valid).toBe(false);
    expect(parseFieldConfig('TABLE', { columns: [{ code: 'A', label: 'A', type: 'TEXT' }, { code: 'A', label: 'B', type: 'TEXT' }] }, null).valid).toBe(false);
    expect(parseFieldConfig('FILE', { maxFiles: 16 }, null).valid).toBe(false);
    expect(parseFieldConfig('FILE', { accept: ['SVG'] }, null).valid).toBe(false);
    expect(parseFieldConfig('FILE', {}, null)).toMatchObject({ valid: true, config: { maxFiles: 1 } });
  });

  it('a data source only fits some types', () => {
    expect(checkFieldDataSource('SELECT', { kind: 'DATASET', datasetId: UUID, column: 'name' }).valid).toBe(true);
    expect(checkFieldDataSource('NUMBER', { kind: 'DATASET', datasetId: UUID, column: 'name' }).valid).toBe(false);
    expect(checkFieldDataSource('CALCULATOR', { kind: 'CALCULATOR', calculatorCode: 'x' }).valid).toBe(true);
    expect(checkFieldDataSource('TEXT', { kind: 'PRESET', preset: 'USERS' }).valid).toBe(false);
    expect(checkFieldDataSource('TEXT', null).valid).toBe(true);
  });
});

describe('transition conditions', () => {
  const parse = (condition: unknown) => transitionConditionSchema.safeParse(condition).success;

  it('values must fit the operator', () => {
    expect(parse([{ field: 'A', op: 'gt', value: 5 }])).toBe(true);
    expect(parse([{ field: 'A', op: 'gt', value: '5' }])).toBe(false);
    expect(parse([{ field: 'A', op: 'in_list', value: ['x', 3] }])).toBe(true);
    expect(parse([{ field: 'A', op: 'in_list', value: 'x' }])).toBe(false);
    expect(parse([{ field: 'A', op: 'equals', value: ['x'] }])).toBe(false);
    expect(parse([{ field: 'A', op: 'date_before', value: '2026-10-01' }])).toBe(true);
    expect(parse([{ field: 'A', op: 'date_before', value: 'tomorrow' }])).toBe(false);
  });

  it('needs one to twenty rules, field codes and known operators only', () => {
    expect(parse([])).toBe(false);
    expect(parse(Array.from({ length: 21 }, () => ({ field: 'A', op: 'equals', value: 'x' })))).toBe(false);
    expect(parse([{ field: 'a', op: 'equals', value: 'x' }])).toBe(false);
    expect(parse([{ field: 'A', op: 'matches', value: 'x' }])).toBe(false);
    expect(parse([{ field: 'A', op: 'equals', value: 'x', extra: 1 }])).toBe(false);
  });

  it('operators apply to the right field types', () => {
    expect(operatorAppliesTo('gt', 'NUMBER')).toBe(true);
    expect(operatorAppliesTo('gt', 'TEXT')).toBe(false);
    expect(operatorAppliesTo('date_after', 'DATETIME')).toBe(true);
    expect(operatorAppliesTo('equals', 'SELECT')).toBe(true);
    expect(operatorAppliesTo('equals', 'TABLE')).toBe(false);
    expect(operatorAppliesTo('contains', 'FILE')).toBe(false);
  });
});
