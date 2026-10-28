import type { AiUsageFigures, PlatformAiUsageQuery } from '@procesabpm/shared';

/** Calendar days in UTC, both included, as `YYYY-MM-DD`. */
export interface AiUsagePeriod {
  readonly from: string;
  readonly to: string;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The asked days, or the current month (UTC) when none were given. */
export function aiUsagePeriodOf(query: PlatformAiUsageQuery, now: Date): AiUsagePeriod {
  if (query.from !== undefined && query.to !== undefined) return { from: query.from, to: query.to };
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return { from: isoDay(new Date(Date.UTC(year, month, 1))), to: isoDay(new Date(Date.UTC(year, month + 1, 0))) };
}

/** The instants the period covers: from its first midnight to the midnight after its last day (exclusive). */
export function aiUsageBounds(period: AiUsagePeriod): { readonly since: Date; readonly until: Date } {
  const until = new Date(`${period.to}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  return { since: new Date(`${period.from}T00:00:00Z`), until };
}

export const NO_AI_USAGE: AiUsageFigures = {
  jobs: { total: 0, succeeded: 0, failed: 0 },
  calls: 0,
  promptTokens: 0,
  cachedPromptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

/** The platform's total: every organization's figures added up. */
export function sumAiUsage(rows: readonly AiUsageFigures[]): AiUsageFigures {
  return rows.reduce<AiUsageFigures>(
    (sum, row) => ({
      jobs: { total: sum.jobs.total + row.jobs.total, succeeded: sum.jobs.succeeded + row.jobs.succeeded, failed: sum.jobs.failed + row.jobs.failed },
      calls: sum.calls + row.calls,
      promptTokens: sum.promptTokens + row.promptTokens,
      cachedPromptTokens: sum.cachedPromptTokens + row.cachedPromptTokens,
      completionTokens: sum.completionTokens + row.completionTokens,
      reasoningTokens: sum.reasoningTokens + row.reasoningTokens,
      totalTokens: sum.totalTokens + row.totalTokens,
    }),
    NO_AI_USAGE,
  );
}
