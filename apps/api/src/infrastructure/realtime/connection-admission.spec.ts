import { describe, expect, it } from 'vitest';
import { type AdmissionTicket, ConnectionAdmission } from './connection-admission.js';

const limits = { maxPendingPerAddress: 2, maxOpenPerAddress: 3, maxUpgradesPerWindow: 5, windowMs: 1_000 };
const ticket = (result: ReturnType<ConnectionAdmission['admit']>): AdmissionTicket => {
  if (typeof result === 'string') throw new Error(`refused: ${result}`);
  return result;
};

describe('ConnectionAdmission', () => {
  it('bounds the connections of one address that have not authenticated yet, and frees the slot on CONNECT or close', () => {
    let now = 0;
    const admission = new ConnectionAdmission(limits, () => now);
    const first = ticket(admission.admit('a'));
    const second = ticket(admission.admit('a'));
    expect(admission.admit('a')).toBe('TOO_MANY_PENDING');
    expect(typeof admission.admit('b')).toBe('object');
    first.authenticated();
    const third = ticket(admission.admit('a'));
    second.release();
    second.release();
    third.authenticated();
    third.authenticated();
    now = 1;
    expect(typeof admission.admit('a')).toBe('object');
  });

  it('bounds all open connections of one address', () => {
    const admission = new ConnectionAdmission(limits, () => 0);
    for (let index = 0; index < 3; index += 1) ticket(admission.admit('a')).authenticated();
    expect(admission.admit('a')).toBe('TOO_MANY_OPEN');
  });

  it('bounds the upgrades per window, then lets the address in again', () => {
    let now = 0;
    const admission = new ConnectionAdmission(limits, () => now);
    for (let index = 0; index < 5; index += 1) ticket(admission.admit('a')).release();
    expect(admission.admit('a')).toBe('TOO_MANY_UPGRADES');
    now = 1_000;
    expect(typeof admission.admit('a')).toBe('object');
  });

  it('forgets idle addresses once their window is over', () => {
    let now = 0;
    const admission = new ConnectionAdmission(limits, () => now);
    ticket(admission.admit('a')).release();
    ticket(admission.admit('b')).release();
    expect(admission.trackedAddresses).toBe(2);
    now = 5_000;
    ticket(admission.admit('c')).release();
    expect(admission.trackedAddresses).toBe(1);
  });
});
