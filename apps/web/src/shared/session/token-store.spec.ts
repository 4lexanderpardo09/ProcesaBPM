import { describe, expect, it, vi } from 'vitest';
import type { AccessToken } from './access-token';
import { createTokenStore } from './token-store';

const token: AccessToken = { value: 't', receivedAt: 0, expiresAt: 1, identity: { userId: 'u', tenantId: 't', sessionId: 's' } };

describe('createTokenStore', () => {
  it('keeps the token and notifies the listeners', () => {
    const store = createTokenStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(token);
    expect(store.get()).toBe(token);
    expect(listener).toHaveBeenLastCalledWith(token);

    store.clear();
    expect(store.get()).toBeUndefined();
    expect(listener).toHaveBeenLastCalledWith(undefined);

    unsubscribe();
    store.set(token);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when clearing an empty store', () => {
    const store = createTokenStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear();
    expect(listener).not.toHaveBeenCalled();
  });
});
