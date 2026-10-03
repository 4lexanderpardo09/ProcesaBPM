import { describe, expect, it } from 'vitest';
import { decodeSignal, encodeSignals, MAX_SIGNAL_BYTES, MAX_USERS_PER_SIGNAL, type RealtimeSignal } from './realtime-signal.js';

const id = (n: number) => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1);

describe('realtime signals', () => {
  it.each<RealtimeSignal>([
    { v: 1, k: 'notifications', t: tenant, u: [id(2), id(3)] },
    { v: 1, k: 'ticket', t: tenant, id: id(4), e: 'ticket.transitioned' },
    { v: 1, k: 'document', t: tenant, id: id(4), d: id(5) },
    { v: 1, k: 'access', s: id(6) },
    { v: 1, k: 'access', t: tenant, u: id(2) },
    { v: 1, k: 'access', t: tenant, r: id(7) },
    { v: 1, k: 'ping', n: 'abcdefghijklmnopqrstuv' },
  ])('round-trips %j', (signal) => {
    const [payload] = encodeSignals([signal]);
    expect(decodeSignal(payload!)).toEqual(signal);
  });

  it('splits a thousand users into payloads of at most 100, each under the NOTIFY limit', () => {
    const users = Array.from({ length: 1000 }, (_, index) => id(index + 10));
    const payloads = encodeSignals([{ v: 1, k: 'notifications', t: tenant, u: users }]);
    expect(payloads).toHaveLength(10);
    const decoded = payloads.map((payload) => decodeSignal(payload)!);
    for (const signal of decoded) {
      expect(signal.k === 'notifications' && signal.u.length <= MAX_USERS_PER_SIGNAL).toBe(true);
    }
    expect(payloads.every((payload) => Buffer.byteLength(payload) <= MAX_SIGNAL_BYTES)).toBe(true);
    expect(decoded.flatMap((signal) => (signal.k === 'notifications' ? signal.u : []))).toEqual(users);
  });

  it.each([
    ['bad JSON', '{not json'],
    ['an unknown kind', JSON.stringify({ v: 1, k: 'chat', t: tenant })],
    ['an unknown version', JSON.stringify({ v: 2, k: 'ticket', t: tenant, id: id(4), e: 'ticket.closed' })],
    ['extra keys (data must never ride along)', JSON.stringify({ v: 1, k: 'ticket', t: tenant, id: id(4), e: 'ticket.closed', title: 'secret' })],
    ['a non-UUID id', JSON.stringify({ v: 1, k: 'ticket', t: 'tenant', id: id(4), e: 'ticket.closed' })],
    ['an unknown change kind', JSON.stringify({ v: 1, k: 'ticket', t: tenant, id: id(4), e: 'ticket.deleted' })],
    ['no recipients', JSON.stringify({ v: 1, k: 'notifications', t: tenant, u: [] })],
    ['an oversize payload', ' '.repeat(MAX_SIGNAL_BYTES + 1)],
  ])('refuses %s', (_label, text) => {
    expect(decodeSignal(text)).toBeUndefined();
  });
});
