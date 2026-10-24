import { meResponseSchema } from '@procesabpm/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { SessionEndedError } from '@/shared/session';
import { createFakeTransport, type FakeHandler } from '@/test/fake-transport';
import { makeJwt } from '@/test/jwt';
import { openSupportVisit } from './support-visit';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const tenant = { id: id(1), name: 'Acme', slug: 'acme' };
const sessions = `/platform/tenants/${id(1)}/support-sessions`;
const labels = { firstName: 'Soporte', lastName: 'ProcesaBPM', role: 'Soporte (solo lectura)' };

/** Each opening is a new visit with its own token. */
function supportApi(handlers: Record<string, FakeHandler> = {}) {
  let opened = 0;
  const open = vi.fn<FakeHandler>(() => {
    opened += 1;
    return { accessToken: makeJwt({ sub: id(9), tid: id(1), sid: id(100 + opened) }), expiresIn: 900, sessionId: id(100 + opened), grantId: id(50), grantExpiresAt: '2026-10-25T15:00:00.000Z' };
  });
  const platform = createFakeTransport({ [sessions]: open, [`${sessions}/${id(101)}`]: () => undefined, [`${sessions}/${id(102)}`]: () => undefined });
  const api = createFakeTransport({ '/companies': () => [], ...handlers });
  return { platform, api, open };
}

const visitOver = ({ platform, api }: ReturnType<typeof supportApi>) =>
  openSupportVisit({ platform: platform.transport, transport: api.transport, tenant, labels, createQueryClient: () => new QueryClient() });

const unauthenticated = () => new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });
const bearerOf = (call: { options: { headers?: Record<string, string> } } | undefined) => call?.options.headers?.Authorization;

describe('openSupportVisit', () => {
  it('reads the organization with the support token, and answers the profile itself (the API has none for a visitor)', async () => {
    const fake = supportApi();
    const visit = await visitOver(fake);

    await visit.session.client.request('/companies');
    expect(bearerOf(fake.api.callsTo('/companies')[0])).toMatch(/^Bearer /);
    const me = await visit.session.client.request('/auth/me', { schema: meResponseSchema });
    expect(me).toMatchObject({ user: { id: id(9), firstName: 'Soporte' }, membership: { role: { name: 'Soporte (solo lectura)' } }, organization: { name: 'Acme' } });
    expect(fake.api.callsTo('/auth/me')).toHaveLength(0);
    expect(visit.session.getState()).toEqual({ status: 'signedIn', identity: { userId: id(9), tenantId: id(1), sessionId: id(101) } });
    expect(visit.grantExpiresAt()).toBe('2026-10-25T15:00:00.000Z');
  });

  it('opens again once when the token is refused, closes the old visit, and retries the requests', async () => {
    let calls = 0;
    const fake = supportApi({
      '/companies': () => {
        calls += 1;
        if (calls <= 2) throw unauthenticated();
        return [];
      },
    });
    const visit = await visitOver(fake);

    await Promise.all([visit.session.client.request('/companies'), visit.session.client.request('/companies')]);
    expect(fake.open).toHaveBeenCalledTimes(2);
    expect(fake.platform.callsTo(`${sessions}/${id(101)}`)).toEqual([expect.objectContaining({ options: { method: 'DELETE' } })]);
    expect(bearerOf(fake.api.calls.at(-1))).toBe(`Bearer ${makeJwt({ sub: id(9), tid: id(1), sid: id(102) })}`);
    expect(visit.endedBecause()).toBeUndefined();
  });

  it('ends when the organization withdrew the access: the cache is dropped and nothing more is sent', async () => {
    const fake = supportApi({
      '/companies': () => {
        throw unauthenticated();
      },
    });
    const visit = await visitOver(fake);
    visit.queryClient.setQueryData(['companies'], ['cached']);
    const onEnd = vi.fn();
    visit.onEnd(onEnd);
    fake.open.mockImplementation(() => {
      throw new ApiError({ status: 403, code: 'SUPPORT_ACCESS_NOT_GRANTED', message: 'x' });
    });

    await expect(visit.session.client.request('/companies')).rejects.toBeInstanceOf(SessionEndedError);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('accessEnded');
    expect(visit.queryClient.getQueryData(['companies'])).toBeUndefined();
    const sent = fake.api.calls.length;
    await expect(visit.session.client.request('/workflows')).rejects.toBeInstanceOf(SessionEndedError);
    expect(fake.api.calls).toHaveLength(sent);
  });

  it('ends with the console session when the renewal is refused with 401', async () => {
    const fake = supportApi({
      '/companies': () => {
        throw unauthenticated();
      },
    });
    const visit = await visitOver(fake);
    fake.open.mockImplementation(() => {
      throw unauthenticated();
    });

    await expect(visit.session.client.request('/companies')).rejects.toBeInstanceOf(SessionEndedError);
    expect(visit.endedBecause()).toBe('platformEnded');
  });

  it('keeps going when the renewal fails for another reason (no connection, a 5xx)', async () => {
    const fake = supportApi({
      '/companies': () => {
        throw unauthenticated();
      },
    });
    const visit = await visitOver(fake);
    fake.open.mockImplementation(() => {
      throw new ApiError({ status: 503, code: 'UNAVAILABLE', message: 'x' });
    });

    await expect(visit.session.client.request('/companies')).rejects.toMatchObject({ status: 503 });
    expect(visit.endedBecause()).toBeUndefined();
  });

  it('closes on the API and here, once; signing out of the visit is closing it', async () => {
    const fake = supportApi();
    const visit = await visitOver(fake);
    const onEnd = vi.fn();
    visit.onEnd(onEnd);

    await visit.session.signOut();
    await visit.close();
    expect(fake.platform.callsTo(`${sessions}/${id(101)}`)).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('closed');
    await expect(visit.session.establish(() => Promise.reject(new Error('never')))).rejects.toThrow(/cannot open another session/);
  });
});
