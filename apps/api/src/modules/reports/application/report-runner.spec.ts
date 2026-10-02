import { ReportTimeoutError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { ReportRunner } from './report-runner.js';

const ability = { rulesFor: () => [{ conditions: undefined }] } as unknown as AppAbility;
const context = { require: () => ({ tenantId: '0199a000-0000-7000-8000-000000000001', userId: 'u' }) } as unknown as TenantContext;
const runnerFailingWith = (error: unknown) => new ReportRunner({ withTenantTransaction: () => Promise.reject(error) } as unknown as TenantTransactionRunner, context);
const filters = { from: '2026-09-01', to: '2026-09-02' };

describe('ReportRunner', () => {
  it('turns a statement timeout (57014) and a transaction timeout (P2028) into a typed error that says what to do', async () => {
    await expect(runnerFailingWith(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })).run(ability, filters, () => Promise.resolve(1))).rejects.toBeInstanceOf(ReportTimeoutError);
    await expect(runnerFailingWith(Object.assign(new Error('Transaction already closed'), { code: 'P2028' })).run(ability, filters, () => Promise.resolve(1))).rejects.toBeInstanceOf(ReportTimeoutError);
  });

  it('leaves every other failure as it is', async () => {
    const failure = new Error('boom');
    await expect(runnerFailingWith(failure).run(ability, filters, () => Promise.resolve(1))).rejects.toBe(failure);
  });

  it('builds the query with the scope of the caller and passes it to the work', async () => {
    const runner = new ReportRunner({ withTenantTransaction: (work: (tx: unknown) => Promise<unknown>) => work({ $executeRaw: () => Promise.resolve(1) }) } as unknown as TenantTransactionRunner, context);
    const query = await runner.run(ability, { ...filters, companyId: 'c' }, (_tx, built) => Promise.resolve(built));
    expect(query).toMatchObject({ tenantId: '0199a000-0000-7000-8000-000000000001', companyId: 'c', scope: { kind: 'all' }, period: { from: '2026-09-01', to: '2026-09-02' } });
  });
});
