import { addDaysToLocalDate, AiDailyLimitReachedError, type AiDailyLimits, type AiUsageToday, localDateOf, zonedTimeToInstant } from '@procesabpm/shared';

/** «Today» for the daily limit: from midnight to midnight in the organization's time zone. */
export interface QuotaDay {
  readonly since: Date;
  readonly resetsAt: Date;
}

export function quotaDay(now: Date, timeZone: string): QuotaDay {
  const today = localDateOf(now.getTime(), timeZone);
  return { since: new Date(zonedTimeToInstant(today, 0, timeZone)), resetsAt: new Date(zonedTimeToInstant(addDaysToLocalDate(today, 1), 0, timeZone)) };
}

export function remainingJobs(limits: AiDailyLimits, today: AiUsageToday): number {
  return today.tokens >= limits.tokensPerDay ? 0 : Math.max(0, limits.jobsPerDay - today.jobs);
}

/** Checked when a request is accepted: a running request may end a little over the token limit. */
export function assertWithinDailyLimit(limits: AiDailyLimits, today: AiUsageToday, day: QuotaDay): void {
  if (remainingJobs(limits, today) === 0) throw new AiDailyLimitReachedError(day.resetsAt.toISOString());
}
