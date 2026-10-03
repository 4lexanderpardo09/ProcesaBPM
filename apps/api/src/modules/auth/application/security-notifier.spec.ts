import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { AuthTransaction, AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { SecurityNoticeRepository } from '../data/security-notice.repository.js';
import { SecurityNotifier } from './security-notifier.js';

const USER_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const SESSION_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';

function setup(enqueue = vi.fn().mockResolvedValue(true)) {
  const tx = {} as AuthTransaction;
  const runner = { withAnonymousTransaction: vi.fn((work: (tx: AuthTransaction) => unknown) => work(tx)) } as unknown as AuthTransactionRunner;
  const logger = { error: vi.fn() };
  const notifier = new SecurityNotifier(runner, { enqueue } as unknown as SecurityNoticeRepository, logger as unknown as JsonLogger);
  return { notifier, enqueue, logger, tx, runner };
}

describe('SecurityNotifier', () => {
  it('queues the notice in the caller’s transaction, with the session when there is one', async () => {
    const { notifier, enqueue, tx } = setup();
    await notifier.notify(tx, USER_ID, 'PASSWORD_CHANGED');
    await notifier.notify(tx, USER_ID, 'PLATFORM_ADMIN_SIGN_IN', SESSION_ID);
    expect(enqueue.mock.calls).toEqual([
      [tx, USER_ID, 'PASSWORD_CHANGED', null],
      [tx, USER_ID, 'PLATFORM_ADMIN_SIGN_IN', SESSION_ID],
    ]);
  });

  it('lets a failure inside the change’s transaction fail the change', async () => {
    const { notifier, tx } = setup(vi.fn().mockRejectedValue(new Error('down')));
    await expect(notifier.notify(tx, USER_ID, 'MFA_DISABLED')).rejects.toThrow('down');
  });

  it('queues a lockout notice in its own transaction and only logs a failure', async () => {
    const { notifier, enqueue, logger, runner } = setup(vi.fn().mockRejectedValue(new Error('down')));
    await expect(notifier.notifyLockout(USER_ID, 'ACCOUNT_LOCKED')).resolves.toBeUndefined();
    expect(runner.withAnonymousTransaction).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), USER_ID, 'ACCOUNT_LOCKED', null);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
