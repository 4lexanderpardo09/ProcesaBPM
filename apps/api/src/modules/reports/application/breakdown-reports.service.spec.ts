import { ReportTooLargeError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { TestClock } from '../../../../test/support/test-clock.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import type { CatalogReportRepository } from '../data/catalog-report.repository.js';
import { INCIDENT_ROW_CAP, type IncidentRepository, type IncidentRow } from '../data/incident.repository.js';
import { BreakdownReportsService } from './breakdown-reports.service.js';
import type { ReportRunner } from './report-runner.js';

const row: IncidentRow = { workflowName: 'W', stepName: 'S', openerId: 'a', openerName: 'A', assigneeId: 'b', assigneeName: 'B', resolved: true, pausedMin: 10 };
const serviceWith = (count: number) =>
  new BreakdownReportsService(
    { run: (_access: unknown, _filters: unknown, work: (tx: unknown, query: unknown) => unknown) => work({}, {}) } as unknown as ReportRunner,
    new TestClock('2026-09-08T14:00:00Z'),
    { rows: async () => Array.from({ length: count }, () => row) } as unknown as IncidentRepository,
    {} as CatalogReportRepository,
  );
const FILTERS = { from: '2026-09-07', to: '2026-09-08' };

describe('BreakdownReportsService.incidentsReport', () => {
  it('groups what it reads when it is within the cap', async () => {
    const report = await serviceWith(3).incidentsReport({} as AppAbility, FILTERS);
    expect(report.byStep[0]).toMatchObject({ count: 3, resolved: 3 });
  });

  it('refuses to report on a truncated read: more incidents than the cap is a filter too wide (422)', async () => {
    await expect(serviceWith(INCIDENT_ROW_CAP).incidentsReport({} as AppAbility, FILTERS)).resolves.toBeDefined();
    await expect(serviceWith(INCIDENT_ROW_CAP + 1).incidentsReport({} as AppAbility, FILTERS)).rejects.toBeInstanceOf(ReportTooLargeError);
  });
});
