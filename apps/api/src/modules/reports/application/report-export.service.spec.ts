import { ReportTooLargeError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { Sheet } from '../../../infrastructure/spreadsheet/spreadsheet-writer.js';
import { SpreadsheetWriter } from '../../../infrastructure/spreadsheet/spreadsheet-writer.js';
import { TestClock } from '../../../../test/support/test-clock.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import type { BreakdownReportsService } from './breakdown-reports.service.js';
import type { PerformanceReportsService } from './performance-reports.service.js';
import { EXPORT_ROW_CAP, ReportExportService } from './report-export.service.js';

class FakeWriter extends SpreadsheetWriter {
  written: Sheet[] = [];
  async write(sheets: readonly Sheet[]): Promise<Buffer> {
    this.written = [...sheets];
    return Buffer.from('xlsx');
  }
}

const FILTERS = { from: '2026-09-07', to: '2026-09-08' };
const ability = { can: () => true } as unknown as AppAbility;

function service(rows: number) {
  const writer = new FakeWriter();
  const performance = {
    steps: async () => Array.from({ length: rows }, (_v, index) => ({ workflowId: 'w', workflowName: 'W', stepName: `S${index}`, visits: 1, onTime: 1, late: 0, noSla: 0, compliancePct: 100, avgMin: 1, medianMin: 1, p90Min: 1, avgPausedMin: 0, reprocesses: 0 })),
  } as unknown as PerformanceReportsService;
  return { writer, exporter: new ReportExportService(performance, {} as BreakdownReportsService, writer, new TestClock('2026-09-08T14:00:00Z'), { withTenantTransaction: (work: (tx: object) => unknown) => work({}) } as never, { record: () => Promise.resolve() } as never) };
}

describe('ReportExportService', () => {
  it('adds a sheet with the filters and names the file by report and day', async () => {
    const { writer, exporter } = service(2);
    const exported = await exporter.export(ability, 'sla-steps', FILTERS);
    expect(exported.fileName).toBe('reporte-sla-steps-2026-09-08.xlsx');
    expect(writer.written.map((sheet) => sheet.name)).toEqual(['SLA por paso', 'Filtros']);
    expect(writer.written[1]!.rows[0]).toEqual(['Desde', '2026-09-07']);
  });

  it('accepts exactly the row cap and refuses one more (422)', async () => {
    await expect(service(EXPORT_ROW_CAP).exporter.export(ability, 'sla-steps', FILTERS)).resolves.toBeDefined();
    await expect(service(EXPORT_ROW_CAP + 1).exporter.export(ability, 'sla-steps', FILTERS)).rejects.toBeInstanceOf(ReportTooLargeError);
  });

  it('refuses to export what the caller may not read', async () => {
    const cannotRead = { can: () => false } as unknown as AppAbility;
    await expect(service(1).exporter.export(cannotRead, 'sla-steps', FILTERS)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses filters that do not pass validation', async () => {
    await expect(service(1).exporter.export(ability, 'sla-steps', { from: '2026-09-09', to: '2026-09-07' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
