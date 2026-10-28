import { describe, expect, it } from 'vitest';
import { aiUsageBounds, aiUsagePeriodOf, NO_AI_USAGE, sumAiUsage } from './ai-usage-report.js';

describe('aiUsagePeriodOf', () => {
  it('keeps the asked days', () => {
    expect(aiUsagePeriodOf({ from: '2026-01-15', to: '2026-03-02' }, new Date('2026-10-27T12:00:00Z'))).toEqual({ from: '2026-01-15', to: '2026-03-02' });
  });

  it.each([
    ['2026-10-27T12:00:00Z', '2026-10-01', '2026-10-31'],
    ['2028-02-10T00:00:00Z', '2028-02-01', '2028-02-29'],
    ['2026-12-31T23:59:59.999Z', '2026-12-01', '2026-12-31'],
  ])('defaults to the current UTC month (%s)', (now, from, to) => {
    expect(aiUsagePeriodOf({}, new Date(now))).toEqual({ from, to });
  });
});

describe('aiUsageBounds', () => {
  it('runs from the first midnight to the midnight after the last day', () => {
    expect(aiUsageBounds({ from: '2026-12-01', to: '2026-12-31' })).toEqual({ since: new Date('2026-12-01T00:00:00Z'), until: new Date('2027-01-01T00:00:00Z') });
    expect(aiUsageBounds({ from: '2026-10-27', to: '2026-10-27' })).toEqual({ since: new Date('2026-10-27T00:00:00Z'), until: new Date('2026-10-28T00:00:00Z') });
  });
});

describe('sumAiUsage', () => {
  it('adds every figure and is zero for no organizations', () => {
    const one = { jobs: { total: 3, succeeded: 2, failed: 1 }, calls: 4, promptTokens: 100, cachedPromptTokens: 10, completionTokens: 200, reasoningTokens: 50, totalTokens: 300 };
    expect(sumAiUsage([])).toEqual(NO_AI_USAGE);
    expect(sumAiUsage([one, one])).toEqual({ jobs: { total: 6, succeeded: 4, failed: 2 }, calls: 8, promptTokens: 200, cachedPromptTokens: 20, completionTokens: 400, reasoningTokens: 100, totalTokens: 600 });
  });
});
