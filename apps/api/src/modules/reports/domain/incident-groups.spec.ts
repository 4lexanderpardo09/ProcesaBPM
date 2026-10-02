import { describe, expect, it } from 'vitest';
import { byAssignee, byOpener, byStep, groupIncidents, type IncidentFact } from './incident-groups.js';

const incident = (overrides: Partial<IncidentFact> = {}): IncidentFact => ({ workflowName: 'Compras', stepName: 'Revisión', openerId: 'u1', openerName: 'Ana', assigneeId: 'u2', assigneeName: 'Beto', resolved: true, pausedMin: 60, ...overrides });

describe('groupIncidents', () => {
  const incidents = [incident({ pausedMin: 60 }), incident({ pausedMin: 180 }), incident({ resolved: false, pausedMin: null }), incident({ stepName: 'Pago', openerId: 'u3', openerName: 'Carla', pausedMin: 30 })];

  it('counts, splits open and resolved, and measures the pause of the resolved ones only', () => {
    expect(groupIncidents(incidents, byStep)).toEqual([
      { key: 'Compras\u0000Revisión', label: 'Compras · Revisión', count: 3, open: 1, resolved: 2, avgPausedMin: 120, medianPausedMin: 120 },
      { key: 'Compras\u0000Pago', label: 'Compras · Pago', count: 1, open: 0, resolved: 1, avgPausedMin: 30, medianPausedMin: 30 },
    ]);
  });

  it('groups by person who opened it and by assignee', () => {
    expect(groupIncidents(incidents, byOpener).map((row) => [row.label, row.count])).toEqual([['Ana', 3], ['Carla', 1]]);
    expect(groupIncidents(incidents, byAssignee).map((row) => [row.label, row.count])).toEqual([['Beto', 4]]);
  });

  it('has no average when nothing was resolved, and takes the middle of an even count', () => {
    expect(groupIncidents([incident({ resolved: false, pausedMin: null })], byStep)[0]).toMatchObject({ avgPausedMin: null, medianPausedMin: null });
    expect(groupIncidents([incident({ pausedMin: 10 }), incident({ pausedMin: 21 })], byStep)[0]).toMatchObject({ medianPausedMin: 16 });
  });
});
