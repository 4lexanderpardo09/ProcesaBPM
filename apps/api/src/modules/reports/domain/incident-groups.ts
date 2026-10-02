import type { IncidentGroupRow } from '@procesabpm/shared';

export interface IncidentFact {
  readonly workflowName: string;
  readonly stepName: string;
  readonly openerId: string;
  readonly openerName: string;
  readonly assigneeId: string;
  readonly assigneeName: string;
  readonly resolved: boolean;
  readonly pausedMin: number | null;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return Math.round(sorted.length % 2 === 1 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
};

/** Groups incidents by a key; the pause is only known for resolved ones. Rows are ordered by how many there are, then by label. */
export function groupIncidents(incidents: readonly IncidentFact[], keyOf: (incident: IncidentFact) => { key: string; label: string }): IncidentGroupRow[] {
  const groups = new Map<string, { label: string; incidents: IncidentFact[] }>();
  for (const incident of incidents) {
    const { key, label } = keyOf(incident);
    const group = groups.get(key) ?? { label, incidents: [] };
    group.incidents.push(incident);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, { label, incidents: members }]): IncidentGroupRow => {
      const paused = members.flatMap((member) => (member.pausedMin === null ? [] : [member.pausedMin]));
      return {
        key,
        label,
        count: members.length,
        open: members.filter((member) => !member.resolved).length,
        resolved: members.filter((member) => member.resolved).length,
        avgPausedMin: paused.length === 0 ? null : Math.round(paused.reduce((sum, value) => sum + value, 0) / paused.length),
        medianPausedMin: median(paused),
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

export const byStep = (incident: IncidentFact) => ({ key: `${incident.workflowName}\u0000${incident.stepName}`, label: `${incident.workflowName} · ${incident.stepName}` });
export const byOpener = (incident: IncidentFact) => ({ key: incident.openerId, label: incident.openerName });
export const byAssignee = (incident: IncidentFact) => ({ key: incident.assigneeId, label: incident.assigneeName });
