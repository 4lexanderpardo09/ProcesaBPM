import { describe, expect, it, vi } from 'vitest';
import { ApiError, type HttpClient } from '@/shared/api';
import { createPlatformSession } from './platform-session';

function transportWith(handler: (path: string, options: { headers?: Record<string, string>; method?: string }) => unknown): { transport: HttpClient; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn((path: string, options: { headers?: Record<string, string>; method?: string; schema?: { parse: (value: unknown) => unknown } } = {}) => {
    const value = handler(path, options);
    return Promise.resolve(options.schema === undefined ? value : options.schema.parse(value));
  });
  return { transport: { request } as unknown as HttpClient, request };
}

describe('createPlatformSession', () => {
  it('opens with the selection token, sends the platform token, and forgets it on a 401', async () => {
    const { transport, request } = transportWith((path) => {
      if (path === '/auth/platform/select') return { accessToken: 'platform-token', tokenType: 'Bearer', expiresIn: 900 };
      throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });
    });
    const session = createPlatformSession(transport);
    const listener = vi.fn();
    session.subscribe(listener);

    await session.open('selection-token');
    expect(request).toHaveBeenCalledWith('/auth/platform/select', expect.objectContaining({ headers: { Authorization: 'Bearer selection-token' } }));
    expect(session.getState()).toMatchObject({ token: 'platform-token' });
    expect(session.getState()!.expiresAt).toBeGreaterThan(Date.now() + 800_000);

    await expect(session.client.request('/platform/tenants')).rejects.toBeInstanceOf(ApiError);
    expect(request).toHaveBeenLastCalledWith('/platform/tenants', { headers: { Authorization: 'Bearer platform-token' } });
    expect(session.getState()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    await expect(session.client.request('/platform/tenants')).rejects.toMatchObject({ status: 401 });
  });

  it('closes on the API and here, even when the API no longer knows it', async () => {
    const { transport, request } = transportWith((path) => {
      if (path === '/auth/platform/select') return { accessToken: 't', tokenType: 'Bearer', expiresIn: 60 };
      throw new ApiError({ status: 500, code: 'INTERNAL', message: 'x' });
    });
    const session = createPlatformSession(transport);
    await session.open('s');
    await session.close();
    expect(request).toHaveBeenLastCalledWith('/auth/platform/logout', { method: 'POST', headers: { Authorization: 'Bearer t' } });
    expect(session.getState()).toBeNull();
  });
});
