import { describe, expect, it } from 'vitest';
import { readSessionMessage } from './session-channel';

describe('readSessionMessage', () => {
  it('accepts a message of this version', () => {
    expect(readSessionMessage({ v: 1, message: { type: 'signed-out', reason: 'userSignedOut' } })).toEqual({ type: 'signed-out', reason: 'userSignedOut' });
  });

  it.each([
    ['another version', { v: 2, message: { type: 'signed-out', reason: 'userSignedOut' } }],
    ['an unknown type', { v: 1, message: { type: 'steal' } }],
    ['a token without expiry', { v: 1, message: { type: 'token', token: 'x', receivedAt: 0 } }],
    ['an unknown reason', { v: 1, message: { type: 'signed-out', reason: 'hacked' } }],
    ['plain text', 'hello'],
    ['nothing', null],
  ])('ignores %s', (_label, data) => {
    expect(readSessionMessage(data)).toBeUndefined();
  });
});
