import readXlsxFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import { WriteExcelFileWriter } from './write-excel-file.writer.js';

const sheetsOf = async (buffer: Buffer): Promise<Array<{ sheet: string; data: unknown[][] }>> => (await readXlsxFile(buffer as never)) as never;
const firstSheet = async (buffer: Buffer): Promise<unknown[][]> => (await sheetsOf(buffer))[0]!.data;

describe('WriteExcelFileWriter', () => {
  const writer = new WriteExcelFileWriter();

  it('writes sheets with a header row, typed numbers and dates, and empty cells', async () => {
    const buffer = await writer.write([{ name: 'Resumen', headers: ['Nombre', 'Total', 'Fecha'], rows: [['Ñandú', 12.5, new Date('2026-09-07T14:00:00Z')], ['Otro', null, null]] }]);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const rows = await firstSheet(buffer);
    expect(rows[0]).toEqual(['Nombre', 'Total', 'Fecha']);
    expect(rows[1]!.slice(0, 2)).toEqual(['Ñandú', 12.5]);
    expect(rows[1]![2]).toBeInstanceOf(Date);
    expect(rows[2]!.slice(0, 2)).toEqual(['Otro', null]);
  });

  it('never writes a formula: text that looks like one is stored as text with an apostrophe', async () => {
    const buffer = await writer.write([{ name: 'Datos', headers: ['=HEADER()', 'Valor'], rows: [['=cmd|\' /C calc\'!A0', 1], ['+1', 2], ['@SUM(1)', 3]] }]);
    const rows = await firstSheet(buffer);
    expect(rows[0]![0]).toBe("'=HEADER()");
    expect(rows.slice(1).map((row) => row[0])).toEqual(["'=cmd|' /C calc'!A0", "'+1", "'@SUM(1)"]);
  });

  it('gives each sheet a valid, unique name', async () => {
    const buffer = await writer.write([{ name: 'A/B', headers: ['x'], rows: [] }, { name: 'a b', headers: ['x'], rows: [] }]);
    expect((await sheetsOf(buffer)).map((entry) => entry.sheet)).toEqual(['A B', 'a b 2']);
  });
});
