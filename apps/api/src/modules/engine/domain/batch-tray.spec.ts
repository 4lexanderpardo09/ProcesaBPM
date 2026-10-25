import type { BatchGroupBy, FieldDocument, StepDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { BatchTicketRow } from '../data/batch-tickets.repository.js';
import { batchSubgroupOf, batchTrayOf } from './batch-tray.js';

const step = (batch: Record<string, unknown> | undefined) => ({ id: 's1', allowsBatch: true, config: batch === undefined ? {} : { batch } }) as StepDocument;
const field = (code: string, type: string, config: Record<string, unknown> = {}) => ({ code, label: `Label ${code}`, type, config }) as FieldDocument;
const row = (overrides: Partial<BatchTicketRow> = {}) =>
  ({ company: { id: 'c1', name: 'Arpesod' }, site: null, department: null, cutoff: null, values: {}, ...overrides }) as BatchTicketRow;

describe('batchTrayOf', () => {
  it('reads the title, the fields in order and the grouping', () => {
    const fields = [field('AMOUNT', 'CURRENCY', { currencyCode: 'COP', min: 0 }), field('NOTE', 'TEXT')];
    expect(batchTrayOf(step({ maxTickets: 10, title: 'Pagos', showFields: ['NOTE', 'AMOUNT'], groupBy: 'COMPANY' }), fields)).toEqual({
      title: 'Pagos',
      shownFields: [
        { code: 'NOTE', label: 'Label NOTE', type: 'TEXT', config: {} },
        { code: 'AMOUNT', label: 'Label AMOUNT', type: 'CURRENCY', config: { currencyCode: 'COP' } },
      ],
      groupBy: 'COMPANY',
      groupField: null,
    });
  });

  it('groups by a field of the version, and keeps one list when the version lacks it', () => {
    const fields = [field('BANK', 'SELECT', { options: [{ value: 'B1', label: 'Bancolombia' }] })];
    expect(batchTrayOf(step({ maxTickets: 10, groupBy: 'FIELD', groupFieldCode: 'BANK' }), fields)).toMatchObject({
      groupBy: 'FIELD',
      groupField: { code: 'BANK', label: 'Label BANK', type: 'SELECT', config: { options: [{ value: 'B1', label: 'Bancolombia' }] } },
    });
    expect(batchTrayOf(step({ maxTickets: 10, groupBy: 'FIELD', groupFieldCode: 'GHOST' }), fields)).toMatchObject({ groupBy: null, groupField: null });
  });

  it('leaves out a field the version lacks, and a step without settings keeps a plain list', () => {
    expect(batchTrayOf(step({ maxTickets: 10, showFields: ['GHOST'] }), []).shownFields).toEqual([]);
    expect(batchTrayOf(step(undefined), [])).toEqual({ title: null, shownFields: [], groupBy: null, groupField: null });
  });
});

describe('batchSubgroupOf', () => {
  const by = (groupBy: BatchGroupBy | null) => ({ groupBy, groupField: null });

  it('is null without grouping and the company otherwise', () => {
    expect(batchSubgroupOf(by(null), row())).toBeNull();
    expect(batchSubgroupOf(by('COMPANY'), row())).toEqual({ key: 'c1', name: 'Arpesod' });
  });

  it('puts a ticket without site, department or file under the empty key', () => {
    expect(batchSubgroupOf(by('REQUESTER_SITE'), row())).toEqual({ key: '', name: '' });
    expect(batchSubgroupOf(by('REQUESTER_DEPARTMENT'), row())).toEqual({ key: '', name: '' });
    expect(batchSubgroupOf(by('EXPORT_CUTOFF'), row())).toEqual({ key: '', name: '' });
    expect(batchSubgroupOf(by('REQUESTER_SITE'), row({ site: { id: 's9', name: 'Barranquilla' } }))).toEqual({ key: 's9', name: 'Barranquilla' });
  });

  it('names a file by its export, date and group', () => {
    const cutoff = { id: 'k1', cutoffDate: new Date('2026-10-20T00:00:00Z'), definitionName: 'Plano bancario', groupLabel: 'Bancolombia' };
    expect(batchSubgroupOf(by('EXPORT_CUTOFF'), row({ cutoff }))).toEqual({ key: 'k1', name: 'Plano bancario · 2026-10-20 · Bancolombia' });
    expect(batchSubgroupOf(by('EXPORT_CUTOFF'), row({ cutoff: { ...cutoff, groupLabel: null } }))?.name).toBe('Plano bancario · 2026-10-20');
  });

  it('splits by the value of a field, and an empty value is "none"', () => {
    const tray = { groupBy: 'FIELD' as const, groupField: { code: 'BANK', label: 'Banco', type: 'SELECT' as const, config: {} } };
    expect(batchSubgroupOf(tray, row({ values: { BANK: 'B1' } }))).toEqual({ key: '"B1"', name: 'B1' });
    expect(batchSubgroupOf(tray, row({ values: { BANK: ['B1', 'B2'] } }))).toEqual({ key: '["B1","B2"]', name: 'B1, B2' });
    expect(batchSubgroupOf(tray, row({ values: { BANK: 5 } }))).toEqual({ key: '5', name: '5' });
    for (const empty of [undefined, null, '', []]) expect(batchSubgroupOf(tray, row({ values: { BANK: empty } }))).toEqual({ key: '', name: '' });
  });
});
