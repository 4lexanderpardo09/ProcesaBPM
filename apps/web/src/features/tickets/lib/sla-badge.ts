import type { TicketSlaResponse } from '@procesabpm/shared';
import type { BadgeTone } from '@/shared/ui';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Less than this left and the deadline reads "por vencer" (warn) instead of on time (ok). */
const DUE_SOON = DAY;

/** The SLA at a glance (README "Color"): on time ok, due soon or paused warn, overdue danger. */
export type SlaBadge =
  | { readonly kind: 'overdue'; readonly tone: BadgeTone }
  | { readonly kind: 'paused'; readonly tone: BadgeTone }
  | { readonly kind: 'remaining'; readonly tone: BadgeTone; readonly days: number; readonly hours: number; readonly minutes: number };

export function slaBadge(sla: TicketSlaResponse | null, now: Date): SlaBadge | undefined {
  if (sla === null) return undefined;
  if (sla.overdue) return { kind: 'overdue', tone: 'danger' };
  if (sla.paused) return { kind: 'paused', tone: 'warn' };
  const left = Math.max(0, new Date(sla.dueAt).getTime() - now.getTime());
  return {
    kind: 'remaining',
    tone: left < DUE_SOON ? 'warn' : 'ok',
    days: Math.floor(left / DAY),
    hours: Math.floor((left % DAY) / HOUR),
    minutes: Math.floor((left % HOUR) / MINUTE),
  };
}
