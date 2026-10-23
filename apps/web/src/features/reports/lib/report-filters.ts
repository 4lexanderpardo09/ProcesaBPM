import { MAX_REPORT_DAYS } from '@procesabpm/shared';

/** The filters every report shares, as they travel in the page's address (empty: not filtered). */
export interface ReportFilters {
  readonly from: string;
  readonly to: string;
  readonly companyId: string;
  readonly workflowId: string;
  readonly departmentId: string;
  readonly siteId: string;
}

const KEYS = ['from', 'to', 'companyId', 'workflowId', 'departmentId', 'siteId'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A local calendar day as `YYYY-MM-DD`. */
export function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The last 30 days, today included: what the reports open with. */
export function defaultPeriod(today: Date = new Date()): { from: string; to: string } {
  return { from: isoDay(new Date(today.getTime() - 29 * DAY_MS)), to: isoDay(today) };
}

/** The filters in the address, with the default period when it has none (or a broken one). */
export function readFilters(params: URLSearchParams, today: Date = new Date()): ReportFilters {
  const value = (key: (typeof KEYS)[number]) => params.get(key) ?? '';
  const period = DATE.test(value('from')) && DATE.test(value('to')) ? { from: value('from'), to: value('to') } : defaultPeriod(today);
  return { ...period, companyId: value('companyId'), workflowId: value('workflowId'), departmentId: value('departmentId'), siteId: value('siteId') };
}

/** The address with these filters, keeping whatever else it had (the tab's own options). */
export function writeFilters(params: URLSearchParams, filters: ReportFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of KEYS) {
    if (filters[key] === '') next.delete(key);
    else next.set(key, filters[key]);
  }
  return next;
}

/** Why a period cannot be asked for, or `undefined` when it can. */
export function periodProblem(from: string, to: string): 'missing' | 'order' | 'length' | undefined {
  if (!DATE.test(from) || !DATE.test(to)) return 'missing';
  if (to < from) return 'order';
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  return days > MAX_REPORT_DAYS ? 'length' : undefined;
}
