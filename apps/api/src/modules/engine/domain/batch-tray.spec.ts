import type { FieldDocument, StepDocument } from '@procesabpm/shared';
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
    });
  });

  it('leaves out a field the version lacks, and a step without settings keeps a plain list', () => {
    expect(batchTrayOf(step({ maxTickets: 10, showFields: ['GHOST'] }), []).shownFields).toEqual([]);
    expect(batchTrayOf(step(undefined), [])).toEqual({ title: null, shownFields: [], groupBy: null });
  });
});

describe('batchSubgroupOf', () => {
  it('is null without grouping and the company otherwise', () => {
    expect(batchSubgroupOf(null, row())).toBeNull();
    expect(batchSubgroupOf('COMPANY', row())).toEqual({ key: 'c1', name: 'Arpesod' });
  });

  it('puts a ticket without site, department or file under the empty key', () => {
    expect(batchSubgroupOf('REQUESTER_SITE', row())).toEqual({ key: '', name: '' });
    expect(batchSubgroupOf('REQUESTER_DEPARTMENT', row())).toEqual({ key: '', name: '' });
    expect(batchSubgroupOf('EXPORT_CUTOFF', row())).toEqual({ key: '', name: '' });
    expect(batchSubgroupOf('REQUESTER_SITE', row({ site: { id: 's9', name: 'Barranquilla' } }))).toEqual({ key: 's9', name: 'Barranquilla' });
  });

  it('names a file by its export, date and group', () => {
    const cutoff = { id: 'k1', cutoffDate: new Date('2026-10-20T00:00:00Z'), definitionName: 'Plano bancario', groupLabel: 'Bancolombia' };
    expect(batchSubgroupOf('EXPORT_CUTOFF', row({ cutoff }))).toEqual({ key: 'k1', name: 'Plano bancario · 2026-10-20 · Bancolombia' });
    expect(batchSubgroupOf('EXPORT_CUTOFF', row({ cutoff: { ...cutoff, groupLabel: null } }))?.name).toBe('Plano bancario · 2026-10-20');
  });
});
