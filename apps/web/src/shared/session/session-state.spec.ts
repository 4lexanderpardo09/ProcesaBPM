import { describe, expect, it } from 'vitest';
import type { SessionIdentity } from './access-token';
import { type SessionState, sessionReducer } from './session-state';

const alice: SessionIdentity = { userId: 'alice', tenantId: 'org-a', sessionId: 's1' };
const aliceRenewed: SessionIdentity = { ...alice, sessionId: 's2' };
const aliceInB: SessionIdentity = { ...alice, tenantId: 'org-b' };

const bootstrapping: SessionState = { status: 'bootstrapping' };
const loading: SessionState = { status: 'loadingProfile', identity: alice };
const signedIn: SessionState = { status: 'signedIn', identity: alice };
const signedOut: SessionState = { status: 'signedOut', reason: undefined };
const unavailable: SessionState = { status: 'unavailable' };
const blocked: SessionState = { status: 'blocked', block: { kind: 'tenantSuspended' } };

describe('sessionReducer', () => {
  it.each<[string, SessionState, Parameters<typeof sessionReducer>[1], SessionState]>([
    ['a token while starting loads the profile', bootstrapping, { type: 'TOKEN_ACQUIRED', identity: alice }, loading],
    ['a token while signed out loads the profile', signedOut, { type: 'TOKEN_ACQUIRED', identity: alice }, loading],
    ['a token while blocked loads the profile', blocked, { type: 'TOKEN_ACQUIRED', identity: alice }, loading],
    ['a renewed token of the same identity changes nothing', signedIn, { type: 'TOKEN_ACQUIRED', identity: aliceRenewed }, signedIn],
    ['a token of another organization reloads the profile', signedIn, { type: 'TOKEN_ACQUIRED', identity: aliceInB }, { status: 'loadingProfile', identity: aliceInB }],
    ['the profile signs in', loading, { type: 'PROFILE_LOADED', identity: alice }, signedIn],
    ['the profile of a previous identity is ignored', { status: 'loadingProfile', identity: aliceInB }, { type: 'PROFILE_LOADED', identity: alice }, { status: 'loadingProfile', identity: aliceInB }],
    ['a failed profile is unavailable', loading, { type: 'PROFILE_FAILED', identity: alice }, unavailable],
    ['no cookie while starting signs out without a notice', bootstrapping, { type: 'REFRESH_FAILED', failure: { kind: 'unauthenticated' } }, signedOut],
    ['a refused refresh while signed in has expired', signedIn, { type: 'REFRESH_FAILED', failure: { kind: 'unauthenticated' } }, { status: 'signedOut', reason: 'expired' }],
    ['MFA required signs out with its notice', signedIn, { type: 'REFRESH_FAILED', failure: { kind: 'mfaRequired' } }, { status: 'signedOut', reason: 'mfaRequired' }],
    ['a block while refreshing', signedIn, { type: 'REFRESH_FAILED', failure: { kind: 'blocked', block: { kind: 'tenantSuspended' } } }, blocked],
    ['a network failure while starting is unavailable', bootstrapping, { type: 'REFRESH_FAILED', failure: { kind: 'network' } }, unavailable],
    ['a network failure while signed in keeps the session', signedIn, { type: 'REFRESH_FAILED', failure: { kind: 'network' } }, signedIn],
    ['a server failure while loading keeps loading', loading, { type: 'REFRESH_FAILED', failure: { kind: 'unavailable' } }, loading],
    ['an ended session signs out with its reason', signedIn, { type: 'SESSION_ENDED', reason: 'signedOutElsewhere' }, { status: 'signedOut', reason: 'signedOutElsewhere' }],
    ['a block', signedIn, { type: 'BLOCKED', block: { kind: 'tenantSuspended' } }, blocked],
    ['retry from unavailable starts again', unavailable, { type: 'RETRY' }, bootstrapping],
    ['retry from blocked starts again', blocked, { type: 'RETRY' }, bootstrapping],
    ['retry while signed in changes nothing', signedIn, { type: 'RETRY' }, signedIn],
    ['a profile while signed out is ignored', signedOut, { type: 'PROFILE_LOADED', identity: alice }, signedOut],
  ])('%s', (_label, from, event, to) => {
    expect(sessionReducer(from, event)).toEqual(to);
  });

  it('returns the same object when nothing changes, so subscribers are not woken', () => {
    expect(sessionReducer(signedIn, { type: 'TOKEN_ACQUIRED', identity: aliceRenewed })).toBe(signedIn);
  });
});
