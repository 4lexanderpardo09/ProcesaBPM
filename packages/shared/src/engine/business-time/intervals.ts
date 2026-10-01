import { InvalidDurationError } from '../../errors/domain-error.js';
import type { Interval } from './compiled-calendar.js';
import type { PausePeriod } from './types.js';

export function normalizePauses(pauses: readonly PausePeriod[] = []): Interval[] {
  const intervals = pauses.map((pause) => {
    const start = pause.from.getTime();
    const end = pause.to.getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      throw new InvalidDurationError('A pause must end after it starts');
    }
    return { start, end };
  });
  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, interval.end) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** Parts of `interval` that are not covered by the (sorted, merged) pauses. */
export function subtractPauses(interval: Interval, pauses: readonly Interval[]): Interval[] {
  const parts: Interval[] = [];
  let cursor = interval.start;
  for (const pause of pauses) {
    if (pause.end <= cursor) continue;
    if (pause.start >= interval.end) break;
    if (pause.start > cursor) parts.push({ start: cursor, end: pause.start });
    cursor = Math.max(cursor, pause.end);
  }
  if (cursor < interval.end) parts.push({ start: cursor, end: interval.end });
  return parts;
}
