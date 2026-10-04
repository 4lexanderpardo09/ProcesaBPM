import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { LoginBlockRepository } from '../data/login-block.repository.js';
import type { LoginBlock } from '../domain/login-block-policy.js';
import { LOGIN_BLOCKS_MAX, LOGIN_BLOCKS_TTL_MS, LoginBlockRegistry } from './login-block-registry.js';

class FakeClock extends Clock {
  constructor(private current: number) {
    super();
  }

  override now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

const START = Date.parse('2026-10-05T10:00:00.000Z');
const block = (overrides: Partial<LoginBlock> = {}): LoginBlock => ({
  id: 'block-1',
  type: 'MAINTENANCE',
  title: 'Window',
  body: 'Back soon',
  startsAt: new Date(START - 60_000),
  endsAt: new Date(START + 3_600_000),
  allTenants: true,
  tenantIds: [],
  ...overrides,
});

function setup(initial: LoginBlock[] = []) {
  const clock = new FakeClock(START);
  const list = vi.fn().mockResolvedValue(initial);
  const runner = { withAnonymousTransaction: vi.fn((work: (tx: object) => unknown) => work({})) } as unknown as AuthTransactionRunner;
  const logger = { warn: vi.fn() };
  const registry = new LoginBlockRegistry(runner, { list } as unknown as LoginBlockRepository, clock, logger as unknown as JsonLogger);
  return { registry, list, clock, logger };
}

describe('LoginBlockRegistry', () => {
  it('answers only the block that applies to the scope', async () => {
    const { registry } = setup([block({ allTenants: false, tenantIds: ['tenant-a'] })]);
    await expect(registry.blockFor({ tenantId: 'tenant-a' })).resolves.toMatchObject({ id: 'block-1' });
    await expect(registry.blockFor({ tenantId: 'tenant-b' })).resolves.toBeUndefined();
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeUndefined();
  });

  it('reads the blocks on first use and then serves them from memory for 30 s', async () => {
    const { registry, list, clock } = setup([block()]);
    await expect(registry.blockFor('SIGN_IN')).resolves.toMatchObject({ id: 'block-1' });
    clock.advance(LOGIN_BLOCKS_TTL_MS - 1);
    await registry.blockFor('SIGN_IN');
    expect(list).toHaveBeenCalledTimes(1);

    clock.advance(1);
    await registry.blockFor('SIGN_IN');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shares one query between concurrent requests', async () => {
    const { registry, list } = setup([block()]);
    await Promise.all([registry.blockFor('SIGN_IN'), registry.blockFor({ tenantId: 't' }), registry.blockFor('SIGN_IN')]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('applies a start and an end on time from the snapshot, without a new query', async () => {
    const { registry, list, clock } = setup([block({ startsAt: new Date(START + 5_000), endsAt: new Date(START + 10_000) })]);
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeUndefined();
    clock.advance(5_000);
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeDefined();
    clock.advance(5_000);
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads again at once after invalidate()', async () => {
    const { registry, list } = setup([block()]);
    await registry.blockFor('SIGN_IN');
    list.mockResolvedValue([]);
    registry.invalidate();
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not let a read that started before invalidate() overwrite the newer snapshot', async () => {
    const { registry, list } = setup();
    let finishOld: (blocks: LoginBlock[]) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise<LoginBlock[]>((resolve) => (finishOld = resolve)));
    const old = registry.blockFor('SIGN_IN');
    registry.invalidate();
    list.mockResolvedValue([]);
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeUndefined();

    finishOld([block()]);
    await old;
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps the last snapshot when a refresh fails, logs it without details, and tries again 30 s later', async () => {
    const { registry, list, clock, logger } = setup([block()]);
    await registry.blockFor('SIGN_IN');
    clock.advance(LOGIN_BLOCKS_TTL_MS);
    list.mockRejectedValueOnce(new Error('connection refused to db.internal:5432'));

    await expect(registry.blockFor('SIGN_IN')).resolves.toMatchObject({ id: 'block-1' });
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { event: 'announcements.login_blocks_refresh_failed', errorName: 'Error' });

    await registry.blockFor('SIGN_IN');
    expect(list).toHaveBeenCalledTimes(2);
    clock.advance(LOGIN_BLOCKS_TTL_MS);
    await registry.blockFor('SIGN_IN');
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('fails open when the very first read fails', async () => {
    const { registry, list } = setup();
    list.mockRejectedValueOnce(new Error('down'));
    await expect(registry.blockFor('SIGN_IN')).resolves.toBeUndefined();
  });

  it('warns when the database returns as many blocks as the cap, and only then', async () => {
    const { registry, list, logger, clock } = setup(Array.from({ length: LOGIN_BLOCKS_MAX - 1 }, (_, index) => block({ id: `b${index}` })));
    await registry.blockFor('SIGN_IN');
    expect(logger.warn).not.toHaveBeenCalled();

    list.mockResolvedValue(Array.from({ length: LOGIN_BLOCKS_MAX }, (_, index) => block({ id: `b${index}` })));
    clock.advance(LOGIN_BLOCKS_TTL_MS);
    await registry.blockFor('SIGN_IN');
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { event: 'announcements.login_blocks_truncated', max: LOGIN_BLOCKS_MAX });
  });

  it('serves the public banner from the same snapshot, without another query', async () => {
    const { registry, list } = setup([block({ id: 'global' }), block({ id: 'targeted', allTenants: false, tenantIds: ['tenant-a'] })]);
    await registry.blockFor('SIGN_IN');
    await expect(registry.publicNotices()).resolves.toMatchObject([{ id: 'global', blocksLogin: true }]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
