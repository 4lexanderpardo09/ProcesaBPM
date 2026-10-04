import { MaintenanceError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { Clock } from '../../../infrastructure/clock.js';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { LoginBlockRegistry } from '../../announcements/application/login-block-registry.js';
import type { LoginBlock } from '../../announcements/domain/login-block-policy.js';
import type { CredentialsRepository } from '../data/credentials.repository.js';
import { SignInGate } from './sign-in-gate.js';

const USER = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const BLOCK: LoginBlock = { id: 'b1', title: 'Window', body: 'x', startsAt: new Date(0), endsAt: null, allTenants: true, tenantIds: [] };

function setup(block: LoginBlock | undefined, platformAdmin = false) {
  const blocks = { blockFor: vi.fn().mockResolvedValue(block) };
  const runner = { withUserTransaction: vi.fn((_userId: string, work: (tx: object) => unknown) => work({})) };
  const credentials = { isPlatformAdmin: vi.fn().mockResolvedValue(platformAdmin) };
  const gate = new SignInGate(
    blocks as unknown as LoginBlockRegistry,
    runner as unknown as AuthTransactionRunner,
    credentials as unknown as CredentialsRepository,
    new Clock(),
  );
  return { gate, blocks, credentials };
}

describe('SignInGate', () => {
  it('lets everybody through without a block, without looking the account up', async () => {
    const { gate, credentials } = setup(undefined);
    await expect(gate.refusalFor(USER)).resolves.toBeUndefined();
    expect(credentials.isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('asks only about blocks for every organization (the sign-in has no tenant yet)', async () => {
    const { gate, blocks } = setup(undefined);
    await gate.refusalFor(USER);
    expect(blocks.blockFor).toHaveBeenCalledWith('SIGN_IN');
  });

  it('refuses a member during a block with the announcement', async () => {
    const { gate } = setup(BLOCK);
    const refusal = await gate.refusalFor(USER);
    expect(refusal).toBeInstanceOf(MaintenanceError);
    expect(refusal?.details.announcementId).toBe('b1');
    await expect(gate.assertOpen(USER)).rejects.toBeInstanceOf(MaintenanceError);
  });

  it('lets a platform administrator through, looked up or told by the caller', async () => {
    await expect(setup(BLOCK, true).gate.assertOpen(USER)).resolves.toBeUndefined();
    const { gate, credentials } = setup(BLOCK, false);
    await expect(gate.refusalFor(USER, true)).resolves.toBeUndefined();
    expect(credentials.isPlatformAdmin).not.toHaveBeenCalled();
  });
});
