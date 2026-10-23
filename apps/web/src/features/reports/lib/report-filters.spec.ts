import { describe, expect, it } from 'vitest';
import { defaultPeriod, periodProblem, readFilters, writeFilters } from './report-filters';

const today = new Date(2026, 9, 22, 15, 0);

describe('report filters', () => {
  it('opens with the last 30 days, today included', () => {
    expect(defaultPeriod(today)).toEqual({ from: '2026-09-23', to: '2026-10-22' });
    expect(readFilters(new URLSearchParams(), today)).toEqual({ from: '2026-09-23', to: '2026-10-22', companyId: '', workflowId: '', departmentId: '', siteId: '' });
    expect(readFilters(new URLSearchParams('from=bad&to=2026-10-01'), today).from).toBe('2026-09-23');
  });

  it('round-trips through the address and keeps the tab’s own options', () => {
    const params = writeFilters(new URLSearchParams('level=2&companyId=old'), { from: '2026-10-01', to: '2026-10-07', companyId: '', workflowId: 'w', departmentId: '', siteId: '' });
    expect(params.toString()).toBe('level=2&from=2026-10-01&to=2026-10-07&workflowId=w');
    expect(readFilters(params, today)).toMatchObject({ from: '2026-10-01', workflowId: 'w', companyId: '' });
  });

  it('says what is wrong with a period', () => {
    expect(periodProblem('', '2026-10-01')).toBe('missing');
    expect(periodProblem('2026-10-02', '2026-10-01')).toBe('order');
    expect(periodProblem('2025-01-01', '2026-10-01')).toBe('length');
    expect(periodProblem('2026-01-01', '2026-10-01')).toBeUndefined();
  });
});
