import { describe, expect, it } from 'vitest';
import { connectionRooms, RoomNames } from './room-names.js';

const T1 = '0199a000-0000-7000-8000-000000000001';
const T2 = '0199a000-0000-7000-8000-000000000002';
const U = '0199a000-0000-7000-8000-000000000003';
const S = '0199a000-0000-7000-8000-000000000004';
const R = '0199a000-0000-7000-8000-000000000005';

describe('RoomNames', () => {
  it('prefixes every tenant room with the tenant', () => {
    expect(RoomNames.member(T1, U)).toBe(`t:${T1}:u:${U}`);
    expect(RoomNames.ticket(T1, S)).toBe(`t:${T1}:ticket:${S}`);
    expect(RoomNames.role(T1, R)).toBe(`t:${T1}:r:${R}`);
  });

  it('never gives two tenants the same room for the same ids', () => {
    expect(RoomNames.member(T1, U)).not.toBe(RoomNames.member(T2, U));
    expect(RoomNames.ticket(T1, S)).not.toBe(RoomNames.ticket(T2, S));
  });

  it('keeps the kinds of room apart', () => {
    const names = [RoomNames.tenant(U), RoomNames.user(U), RoomNames.session(U)];
    expect(new Set(names).size).toBe(names.length);
  });

  it('a connection joins its tenant, member, role, account and session rooms', () => {
    expect(connectionRooms({ tenantId: T1, userId: U, sessionId: S, roleId: R })).toEqual([`t:${T1}`, `t:${T1}:u:${U}`, `t:${T1}:r:${R}`, `u:${U}`, `s:${S}`]);
  });
});
