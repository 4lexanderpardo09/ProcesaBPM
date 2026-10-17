import type { AccessToken } from './access-token';

export type TokenListener = (token: AccessToken | undefined) => void;

/** The access token lives only here, in memory: never in storage, the URL or the history state. */
export interface TokenStore {
  get(): AccessToken | undefined;
  set(token: AccessToken): void;
  clear(): void;
  subscribe(listener: TokenListener): () => void;
}

export function createTokenStore(): TokenStore {
  let current: AccessToken | undefined;
  const listeners = new Set<TokenListener>();
  const notify = () => listeners.forEach((listener) => listener(current));

  return {
    get: () => current,
    set(token) {
      current = token;
      notify();
    },
    clear() {
      if (current === undefined) return;
      current = undefined;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
