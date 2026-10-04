import { describe, expect, it } from 'vitest';
import { DATASET_READERS } from '../data/dataset-readers/index.js';
import { CSV_DATASETS, EXPORT_DATASETS, EXPORT_GROUPS, SENSITIVE_COLUMN_NAME } from './export-datasets.js';

describe('EXPORT_DATASETS', () => {
  it('names every dataset once, in the group order', () => {
    const names = EXPORT_DATASETS.map((dataset) => dataset.name);
    expect(new Set(names).size).toBe(names.length);
    const groups = EXPORT_DATASETS.map((dataset) => EXPORT_GROUPS.indexOf(dataset.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  it('pages by key columns that the dataset outputs, and outputs each column once', () => {
    for (const dataset of EXPORT_DATASETS) {
      expect(dataset.key.length, dataset.name).toBeGreaterThan(0);
      expect(dataset.key.every((column) => dataset.columns.includes(column)), dataset.name).toBe(true);
      expect(new Set(dataset.columns).size, dataset.name).toBe(dataset.columns.length);
    }
  });

  it('carries the tenant in every row (the leak checks read it), the organization itself by its id', () => {
    for (const dataset of EXPORT_DATASETS) expect(dataset.columns[0], dataset.name).toBe(dataset.name === 'tenants' ? 'id' : 'tenant_id');
  });

  it('has a reader for every dataset and no reader without a dataset', () => {
    expect(Object.keys(DATASET_READERS).sort()).toEqual(EXPORT_DATASETS.map((dataset) => dataset.name).sort());
    for (const dataset of EXPORT_DATASETS) expect(DATASET_READERS[dataset.name].start, dataset.name).toHaveLength(dataset.key.length);
  });

  it('every reader filters the tenant explicitly and never selects *', () => {
    for (const dataset of EXPORT_DATASETS) {
      const query = DATASET_READERS[dataset.name].page('00000000-0000-7000-8000-000000000001', DATASET_READERS[dataset.name].start, 10);
      expect(query.text, dataset.name).not.toMatch(/\*/);
      expect(query.text, dataset.name).toMatch(dataset.name === 'tenants' ? /WHERE id = \$1::uuid/ : /tenant_id = \$1::uuid/);
      expect(query.values[0]).toBe('00000000-0000-7000-8000-000000000001');
    }
  });

  it('writes CSV for tickets, field values, events, members and audit (decision B15)', () => {
    expect([...CSV_DATASETS].sort()).toEqual(['audit_logs', 'members', 'ticket_events', 'ticket_field_values', 'tickets']);
  });

  it('flags names that look like secrets', () => {
    for (const name of ['password_hash', 'secret_encrypted', 'token_hash', 'mfa_secret', 'code_hash', 'storage_key', 'api_credential', 'otp_code', 'salt', 'session_id', 'signing_key', 'private_note', 'recovery_codes', 'nonce']) expect(SENSITIVE_COLUMN_NAME.test(name), name).toBe(true);
    for (const name of ['sha256', 'title', 'document_number']) expect(SENSITIVE_COLUMN_NAME.test(name), name).toBe(false);
  });
});
