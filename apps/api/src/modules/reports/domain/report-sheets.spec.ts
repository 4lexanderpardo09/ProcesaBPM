import { describe, expect, it } from 'vitest';
import { backlogSheets, commentText, categoriesSheets, distributionSheets, incidentsSheets, rankingSheets, responsiblesSheets, rowCount, stepsSheets, summarySheets, userDetailSheets } from './report-sheets.js';

const ranking = { rank: 1, userId: 'u', name: 'Ana', delivered: 5, handled: 6, onTime: 5, late: 1, errors: 1, compliance: 5 / 6, quality: 0.8, score: 66.7, weighted: 76.6, classification: 'GREEN' as const, medianMin: 120 };

describe('report sheets', () => {
  it('a sheet has as many cells in each row as headers', () => {
    const sheets = [
      ...summarySheets({ timeZones: [], created: 1, closed: 1, open: 0, stepOnTimePct: null, responsibleOnTimePct: 50, avgResolutionMin: 10, medianResolutionMin: 10, unmeasuredTickets: 0 }),
      ...responsiblesSheets([{ userId: null, name: null, clocks: 1, onTime: 1, late: 0, handedOff: 0, noSla: 0, compliancePct: 100, avgMin: 1, medianMin: 1, avgPausedMin: 0 }]),
      ...stepsSheets([{ workflowId: 'w', workflowName: 'W', stepName: 'S', visits: 1, onTime: 1, late: 0, noSla: 0, compliancePct: 100, avgMin: 1, medianMin: 1, p90Min: 1, avgPausedMin: 0, reprocesses: 0 }]),
      ...rankingSheets({ minVolume: 1, ranked: [ranking], unranked: [{ ...ranking, rank: null, score: null, compliance: null, quality: null, weighted: null, classification: null }] }),
      ...distributionSheets({ byStep: [{ workflowId: 'w', workflowName: 'W', stepName: 'S', visits: 1, min: 1, p25: 1, median: 1, p75: 1, p90: 1, max: 1 }], byWorkflow: [{ workflowId: 'w', workflowName: 'W', tickets: 1, min: 1, p25: 1, median: 1, p75: 1, p90: 1, max: 1 }] }),
      ...incidentsSheets({ byStep: [{ key: 'k', label: 'L', count: 1, open: 0, resolved: 1, avgPausedMin: 1, medianPausedMin: 1 }], byOpener: [], byAssignee: [] }),
      ...categoriesSheets([{ categoryId: 'c', categoryName: 'C', subcategoryId: null, subcategoryName: null, created: 1, open: 0, closed: 1, avgResolutionMin: 1 }]),
      ...backlogSheets({ asOf: '2026-09-08T14:00:00.000Z', rows: [{ workflowId: 'w', workflowName: 'W', stepName: 'S', open: 1, paused: 0, overdue: 1, avgAgeDays: 1, maxAgeDays: 1, avgHoursInStep: 24, ageBuckets: [1, 0, 0, 0] }] }),
      ...userDetailSheets({ userId: 'u', name: 'Ana', summary: ranking, clocks: { items: [{ ticketNumber: '1', workflowName: 'W', stepName: 'S', loop: 1, startedAt: '2026-09-07T14:00:00.000Z', completedAt: null, dueAt: null, businessMin: null, pausedMin: 0, result: 'LATE', completionReason: 'STEP_EXITED' }], page: 1, pageSize: 25, total: 1 } }),
    ];
    for (const sheet of sheets) for (const row of sheet.rows) expect(row, sheet.name).toHaveLength(sheet.headers.length);
    expect(rowCount(sheets)).toBeGreaterThan(8);
  });

  it('an anonymous pool and a category total get a readable label', () => {
    expect(responsiblesSheets([{ userId: null, name: null, clocks: 1, onTime: 0, late: 0, handedOff: 0, noSla: 1, compliancePct: null, avgMin: null, medianMin: null, avgPausedMin: null }])[0]!.rows[0]![0]).toBe('(sin tomar)');
    expect(categoriesSheets([{ categoryId: 'c', categoryName: 'C', subcategoryId: null, subcategoryName: null, created: 1, open: 0, closed: 1, avgResolutionMin: 1 }])[0]!.rows[0]![1]).toBe('(total)');
  });

  it('shows the compliance and the quality of the ranking as percentages', () => {
    const [ranked] = rankingSheets({ minVolume: 1, ranked: [ranking], unranked: [] });
    expect(ranked!.rows[0]).toEqual([1, 'Ana', 6, 5, 5, 1, 1, 83.3, 80, 66.7, 76.6, 'Verde', 120]);
  });

  it('turns a comment into the plain text of a cell: paragraphs and breaks kept, tags and entities gone', () => {
    expect(commentText('<p>Hola <strong>Ana</strong></p><p>Va el soporte&nbsp;&amp; la factura<br>Gracias</p>')).toBe('Hola Ana\nVa el soporte & la factura\nGracias');
    expect(commentText('<p></p><p></p><p></p><p>x</p>')).toBe('x');
    expect(commentText('<p>Pagos:</p><table><tbody><tr><th><p>Mes</p></th><th><p>Valor</p></th></tr><tr><td><p>Enero</p></td><td><p>1.250.000</p></td></tr></tbody></table>')).toBe('Pagos:\nMes\tValor\nEnero\t1.250.000');
  });
});
