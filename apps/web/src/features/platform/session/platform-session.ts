import { accessTokenResponseSchema } from '@procesabpm/shared';
import { ApiError, type HttpClient, type RequestOptions } from '@/shared/api';

const UNAUTHORIZED = 401;

/** An open platform session: its short token and when it stops working. */
export interface PlatformSessionState {
  readonly token: string;
  readonly expiresAt: number;
}

export interface PlatformSession {
  /** `null` while no console is open (or after it ended). */
  getState(): PlatformSessionState | null;
  subscribe(listener: () => void): () => void;
  /** Opens the console with the selection token of the sign-in (`POST /auth/platform/select`). */
  open(selectionToken: string): Promise<void>;
  /** Closes it on the API (best effort) and here. */
  close(): Promise<void>;
  /** Forgets the token: it expired, or the API no longer takes it. */
  end(): void;
  /** Requests with the platform token; a 401 ends the session. */
  readonly client: HttpClient;
}

/**
 * The platform administrator's console session. The API gives a short token with no refresh and no cookie, so it lives
 * only in memory: a reload, its expiry or a 401 sends the person back to sign in. It is apart from the organizations'
 * session and never touches it.
 */
export function createPlatformSession(transport: HttpClient): PlatformSession {
  let state: PlatformSessionState | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PlatformSessionState | null) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const end = () => {
    if (state !== null) set(null);
  };

  async function request(path: string, options: RequestOptions & Record<string, unknown> = {}): Promise<unknown> {
    const current = state;
    if (current === null) throw new ApiError({ status: UNAUTHORIZED, code: 'UNAUTHENTICATED', message: 'The platform session ended' });
    try {
      return await (transport.request as (path: string, options: unknown) => Promise<unknown>)(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${current.token}` } });
    } catch (error) {
      if (error instanceof ApiError && error.status === UNAUTHORIZED) end();
      throw error;
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async open(selectionToken) {
      const issued = await transport.request('/auth/platform/select', { method: 'POST', headers: { Authorization: `Bearer ${selectionToken}` }, schema: accessTokenResponseSchema });
      set({ token: issued.accessToken, expiresAt: Date.now() + issued.expiresIn * 1000 });
    },
    async close() {
      try {
        if (state !== null) await request('/auth/platform/logout', { method: 'POST' });
      } catch {
        // Already gone on the API: forgetting it here is all that is left.
      } finally {
        end();
      }
    },
    end,
    client: { request } as HttpClient,
  };
}
