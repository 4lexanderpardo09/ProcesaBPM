import { MaintenanceError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { blockFor, type LoginBlock, MAX_RETRY_AFTER_SECONDS, maintenanceErrorFor, publicNoticesOf, retryAfterSeconds } from './login-block-policy.js';

const NOW = new Date('2026-10-05T10:00:00.000Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const TENANT_A = '018f3c1e-7b2a-7c3d-9e4f-00000000000a';
const TENANT_B = '018f3c1e-7b2a-7c3d-9e4f-00000000000b';

const block = (overrides: Partial<LoginBlock> = {}): LoginBlock => ({
  id: 'block-1',
  type: 'MAINTENANCE',
  title: 'Window',
  body: 'Back soon',
  startsAt: at(-10),
  endsAt: at(10),
  allTenants: true,
  tenantIds: [],
  ...overrides,
});

describe('blockFor', () => {
  it.each<[string, Partial<LoginBlock>, boolean]>([
    ['before the start', { startsAt: at(1) }, false],
    ['exactly at the start', { startsAt: NOW }, true],
    ['exactly at the end (the end is exclusive)', { endsAt: NOW }, false],
    ['after the end', { endsAt: at(-1) }, false],
    ['with no end', { endsAt: null }, true],
    ['starting within the cached 24 hours, not yet', { startsAt: at(60 * 23), endsAt: at(60 * 25) }, false],
  ])('an announcement for every organization %s blocks: %s', (_label, overrides, blocked) => {
    expect(blockFor([block(overrides)], NOW, 'SIGN_IN') !== undefined).toBe(blocked);
    expect(blockFor([block(overrides)], NOW, { tenantId: TENANT_A }) !== undefined).toBe(blocked);
  });

  it('a targeted announcement blocks only its organizations, and never the sign-in itself', () => {
    const targeted = block({ allTenants: false, tenantIds: [TENANT_A] });
    expect(blockFor([targeted], NOW, { tenantId: TENANT_A })).toBe(targeted);
    expect(blockFor([targeted], NOW, { tenantId: TENANT_B })).toBeUndefined();
    expect(blockFor([targeted], NOW, 'SIGN_IN')).toBeUndefined();
  });

  it('of two in force, answers the one that lasts longest (no end lasts longest)', () => {
    const short = block({ id: 'short', endsAt: at(5) });
    const long = block({ id: 'long', endsAt: at(50) });
    const endless = block({ id: 'endless', endsAt: null });
    expect(blockFor([short, long], NOW, 'SIGN_IN')).toBe(long);
    expect(blockFor([short, endless, long], NOW, 'SIGN_IN')).toBe(endless);
  });

  it('breaks a tie by id, so every instance answers the same', () => {
    const second = block({ id: 'b', endsAt: null });
    const first = block({ id: 'a', endsAt: null });
    expect(blockFor([second, first], NOW, 'SIGN_IN')).toBe(first);
  });

  it('answers nothing without blocks', () => {
    expect(blockFor([], NOW, 'SIGN_IN')).toBeUndefined();
  });
});

describe('retryAfterSeconds', () => {
  it.each<[string, Date | null, number | undefined]>([
    ['the seconds left, rounded up', new Date(NOW.getTime() + 90_500), 91],
    ['at least one second', new Date(NOW.getTime() + 10), 1],
    ['at most a day', at(60 * 48), MAX_RETRY_AFTER_SECONDS],
    ['none without an end', null, undefined],
  ])('is %s', (_label, endsAt, expected) => {
    expect(retryAfterSeconds(block({ endsAt }), NOW)).toBe(expected);
  });
});

describe('maintenanceErrorFor', () => {
  it('carries the announcement and when to retry, nothing about its audience', () => {
    const error = maintenanceErrorFor(block({ allTenants: false, tenantIds: [TENANT_A, TENANT_B] }), NOW);
    expect(error).toBeInstanceOf(MaintenanceError);
    expect(error.details).toEqual({ announcementId: 'block-1', title: 'Window', body: 'Back soon', endsAt: at(10).toISOString() });
    expect(error.retryAfterSeconds).toBe(600);
    expect(JSON.stringify(error.details)).not.toContain(TENANT_B);
  });
});

describe('publicNoticesOf', () => {
  it('lists only the blocks for every organization in force now, newest first, without their audience', () => {
    const older = block({ id: 'older', startsAt: at(-30) });
    const newer = block({ id: 'newer', startsAt: at(-5), endsAt: null });
    const targeted = block({ id: 'targeted', allTenants: false, tenantIds: [TENANT_A] });
    const upcoming = block({ id: 'upcoming', startsAt: at(60), endsAt: at(120) });

    const notices = publicNoticesOf([older, targeted, upcoming, newer], NOW);

    expect(notices.map((notice) => notice.id)).toEqual(['newer', 'older']);
    expect(notices[0]).toEqual({ id: 'newer', type: 'MAINTENANCE', title: 'Window', body: 'Back soon', startsAt: at(-5).toISOString(), endsAt: null, blocksLogin: true });
    expect(JSON.stringify(notices)).not.toContain(TENANT_A);
  });
});
