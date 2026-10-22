import type { ExportColumn, ExportSchedule } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { fillFileColumns, mergeRows, separateLines, toCsv } from './file-rows.js';
import { type LineSource, passesFilter, projectLine, tableSum } from './line-projection.js';
import { isCutoffDue, lastOccurrence, nextOccurrence } from './schedule.js';
import { dayMonthYear, formatValue, parseLocaleNumber } from './value-format.js';

const column = (header: string, sourceType: ExportColumn['sourceType'], sourceRef: string | null = null, format: ExportColumn['format'] = null): ExportColumn => ({ header, sourceType, sourceRef, format });
const source = (overrides: Partial<LineSource> = {}): LineSource => ({
  values: { DOC: ' 1.144.068.817 ', AMOUNT: '1.250.000', BANK: 'bancolombia', ITEMS: [{ VALUE: 1000 }, { VALUE: '2.500' }, { VALUE: 'x' }] },
  companyName: 'Arpesod',
  requester: { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', documentNumber: '52000111' },
  ticketDate: '2026-10-21',
  catalogs: new Map([['BANKS', new Map([['bancolombia', '07']])]]),
  formulas: new Map([['Total', '3500']]),
  ...overrides,
});

describe('value formats', () => {
  it('reads numbers as people write them here', () => {
    expect(parseLocaleNumber('$ 1.234.567,89')).toBe(1234567.89);
    expect(parseLocaleNumber('1.234.567')).toBe(1234567);
    expect(parseLocaleNumber('1234567.89')).toBe(1234567.89);
    expect(parseLocaleNumber('abc')).toBeNull();
  });

  it('formats each column, leaving what does not parse as it was', () => {
    expect(formatValue(' ana ', 'UPPER')).toBe('ANA');
    expect(formatValue('1.250.000,6', 'INTEGER')).toBe('1250001');
    expect(formatValue('0', 'INTEGER_OR_EMPTY')).toBe('');
    expect(formatValue('1250000', 'DECIMAL_2')).toBe('1250000.00');
    expect(formatValue('n/a', 'DECIMAL_2')).toBe('n/a');
    expect(dayMonthYear('2026-10-21T23:30:00.000Z')).toBe('21/10/2026');
  });
});

describe('projectLine', () => {
  it('takes each column from its source, leaving the file columns empty', () => {
    const columns = [
      column('Doc', 'FIELD', 'DOC', 'TRIM'),
      column('Amount', 'FIELD', 'AMOUNT', 'INTEGER'),
      column('Bank', 'CATALOG', 'BANKS:BANK'),
      column('Kind', 'CONSTANT', 'PAY'),
      column('Company', 'COMPANY'),
      column('Name', 'REQUESTER', 'FULL_NAME', 'UPPER'),
      column('Items', 'TABLE_SUM', 'ITEMS:VALUE'),
      column('Total', 'FORMULA', '{AMOUNT}'),
      column('Date', 'TICKET_DATE', null, 'DATE_DMY'),
      column('Row', 'SEQUENCE'),
      column('Cutoff', 'CUTOFF_DATE'),
    ];
    expect(projectLine(columns, source())).toEqual({ Doc: '1.144.068.817', Amount: '1250000', Bank: '07', Kind: 'PAY', Company: 'Arpesod', Name: 'ANA PÉREZ', Items: '3500', Total: '3500', Date: '21/10/2026', Row: '', Cutoff: '' });
  });

  it('keeps a value the catalog does not know, and sums only the numbers of a table', () => {
    expect(projectLine([column('Bank', 'CATALOG', 'BANKS:BANK')], source({ values: { BANK: 'Davivienda' } }))).toEqual({ Bank: 'Davivienda' });
    expect(tableSum({ T: [{ A: 2 }, { A: 'nope' }] }, 'T:A')).toBe(2);
    expect(tableSum({ T: 'not a table' }, 'T:A')).toBe(0);
  });
});

describe('passesFilter', () => {
  const values = { BANK: ' Bancolombia ', CITY: 'Cali' };
  it('needs every rule, without case or outer spaces', () => {
    expect(passesFilter([], values)).toBe(true);
    expect(passesFilter([{ fieldCode: 'BANK', operator: 'EQUALS', value: 'bancolombia' }], values)).toBe(true);
    expect(passesFilter([{ fieldCode: 'BANK', operator: 'NOT_EQUALS', value: 'bancolombia' }], values)).toBe(false);
    expect(passesFilter([{ fieldCode: 'BANK', operator: 'STARTS_WITH', value: 'banco' }, { fieldCode: 'CITY', operator: 'IN_LIST', value: 'Bogotá, cali' }], values)).toBe(true);
    expect(passesFilter([{ fieldCode: 'CITY', operator: 'CONTAINS', value: 'medel' }], values)).toBe(false);
  });
});

describe('file rows', () => {
  const columns = [column('Doc', 'FIELD', 'DOC'), column('Name', 'FIELD', 'NAME'), column('Amount', 'FIELD', 'AMOUNT', 'DECIMAL_2'), column('Row', 'SEQUENCE'), column('Cutoff', 'CUTOFF_DATE')];

  it('merges rows of the same key, adding the amounts and keeping the first value', () => {
    const rows = [
      { Doc: '1.144', Name: '', Amount: '10.00' },
      { Doc: '9', Name: 'Luis', Amount: '1.00' },
      { Doc: '1144 ', Name: 'Ana', Amount: '5,50' },
      { Doc: '', Name: 'Alone', Amount: '2.00' },
    ];
    expect(mergeRows(columns, rows, 'Doc')).toEqual([
      { Doc: '1.144', Name: 'Ana', Amount: '15.50', Row: '', Cutoff: '' },
      { Doc: '9', Name: 'Luis', Amount: '1.00' },
      { Doc: '', Name: 'Alone', Amount: '2.00' },
    ]);
  });

  it('numbers the rows and writes the cutoff date', () => {
    expect(fillFileColumns(columns, [{ Doc: 'a' }, { Doc: 'b' }], '2026-10-22')).toEqual([
      { Doc: 'a', Row: '1', Cutoff: '22/10/2026' },
      { Doc: 'b', Row: '2', Cutoff: '22/10/2026' },
    ]);
  });

  it('splits by the step\'s holder, holding back the unassigned, or by a column value', () => {
    const lines = [{ id: 1, holder: 'u1' }, { id: 2, holder: null }, { id: 3, holder: 'u1' }, { id: 4, holder: 'gone' }];
    const help = {
      holder: (line: (typeof lines)[number]) => (line.holder === 'gone' ? { onStep: false, userId: null } : { onStep: true, userId: line.holder }),
      nameOf: (userId: string) => (userId === 'u1' ? 'Ana' : userId),
      cell: (line: (typeof lines)[number]) => (line.id % 2 === 0 ? 'Cali' : ''),
      withoutResponsible: 'Without responsible',
      blank: '(blank)',
    };
    const byHolder = separateLines(lines, { kind: 'RESPONSIBLE', stepId: 's' }, help);
    expect(byHolder.groups.map((group) => [group.label, group.responsibleId, group.lines.map((line) => line.id)])).toEqual([
      ['Ana', 'u1', [1, 3]],
      ['Without responsible', null, [4]],
    ]);
    expect(byHolder.waiting.map((line) => line.id)).toEqual([2]);
    expect(separateLines(lines, { kind: 'COLUMN', header: 'City' }, help).groups.map((group) => [group.label, group.lines.length])).toEqual([
      ['(blank)', 2],
      ['Cali', 2],
    ]);
    expect(separateLines([], null, help).groups).toEqual([]);
  });

  it('writes a CSV with CRLF lines, quoting only the cells that need it', () => {
    expect(toCsv(['A', 'B'], [{ A: 'x;y', B: 'say "hi"' }, { A: '1', B: '' }], ';').toString('utf-8')).toBe('A;B\r\n"x;y";"say ""hi"""\r\n1;\r\n');
  });
});

describe('schedule', () => {
  const tz = 'America/Bogota';
  const schedule = (overrides: Partial<ExportSchedule>): ExportSchedule => ({ cutoffTime: '17:00', frequency: 'DAILY', weekdays: [], monthDay: null, intervalDays: null, ...overrides });
  // Thursday 22 October 2026, 18:00 in Bogotá (UTC-5).
  const now = new Date('2026-10-22T23:00:00.000Z');

  it('a daily cutoff is due once its time passed since the last run', () => {
    expect(lastOccurrence(schedule({}), now, tz)?.toISOString()).toBe('2026-10-22T22:00:00.000Z');
    expect(isCutoffDue(schedule({}), now, tz, null)).toBe(true);
    expect(isCutoffDue(schedule({}), now, tz, new Date('2026-10-22T22:00:05.000Z'))).toBe(false);
    expect(isCutoffDue(schedule({}), now, tz, new Date('2026-10-21T22:00:05.000Z'))).toBe(true);
    expect(isCutoffDue(schedule({ cutoffTime: '19:00' }), now, tz, new Date('2026-10-22T00:00:05.000Z'))).toBe(false);
  });

  it('a weekly cutoff runs on its days, and a monthly one on its day (the last one of a short month)', () => {
    expect(lastOccurrence(schedule({ frequency: 'WEEKLY', weekdays: [1, 3] }), now, tz)?.toISOString()).toBe('2026-10-21T22:00:00.000Z');
    expect(nextOccurrence(schedule({ frequency: 'WEEKLY', weekdays: [1] }), now, tz, null)?.toISOString()).toBe('2026-10-26T22:00:00.000Z');
    expect(nextOccurrence(schedule({ frequency: 'MONTHLY', monthDay: 31 }), new Date('2026-11-10T12:00:00.000Z'), tz, null)?.toISOString()).toBe('2026-11-30T22:00:00.000Z');
  });

  it('every N days counts from the last automatic run', () => {
    const every = schedule({ frequency: 'EVERY_N_DAYS', intervalDays: 3 });
    expect(isCutoffDue(every, now, tz, null)).toBe(true);
    expect(isCutoffDue(every, now, tz, new Date('2026-10-20T22:00:00.000Z'))).toBe(false);
    expect(isCutoffDue(every, now, tz, new Date('2026-10-19T22:00:00.000Z'))).toBe(true);
  });
});
