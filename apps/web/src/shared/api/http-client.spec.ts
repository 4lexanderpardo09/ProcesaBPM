import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, NetworkError, UnexpectedResponseError } from './api-error';
import { createHttpClient } from './http-client';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function clientWith(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>) {
  return { fetchFn, client: createHttpClient({ baseUrl: '/api/', fetchFn }) };
}

const clientAnswering = (response: Response) => clientWith(vi.fn<typeof fetch>(() => Promise.resolve(response)));
const clientFailingWith = (error: unknown) => clientWith(vi.fn<typeof fetch>(() => Promise.reject(error)));

const tagSchema = z.object({ id: z.string(), name: z.string() });

describe('createHttpClient', () => {
  it('sends JSON to the path under the base URL and parses the body with the contract', async () => {
    const { client, fetchFn } = clientAnswering(jsonResponse(201, { id: 't1', name: 'Urgente' }));

    const tag = await client.request('/tags', { method: 'POST', body: { name: 'Urgente' }, schema: tagSchema });

    expect(tag).toEqual({ id: 't1', name: 'Urgente' });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/tags');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"name":"Urgente"}' });
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('sends no body nor content type on a GET', async () => {
    const { client, fetchFn } = clientAnswering(jsonResponse(200, []));
    await client.request('/tags');
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init).not.toHaveProperty('body');
    expect(init?.headers).not.toHaveProperty('Content-Type');
  });

  it('resolves to undefined on 204', async () => {
    const { client } = clientAnswering(new Response(null, { status: 204 }));
    await expect(client.request('/tags/t1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('turns an error body into an ApiError with its code, request id and details', async () => {
    const { client } = clientAnswering(
      jsonResponse(409, { error: { code: 'DUPLICATE', message: 'Duplicate', requestId: 'req-1', details: { field: 'name' } } }),
    );

    const error = await client.request('/tags', { method: 'POST', body: {} }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'DUPLICATE', message: 'Duplicate', requestId: 'req-1', details: { field: 'name' } });
  });

  it('still fails with an ApiError when the error body is not the API format', async () => {
    const { client } = clientAnswering(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(client.request('/tags')).rejects.toMatchObject({ name: 'ApiError', status: 502, code: 'UNKNOWN_ERROR' });
  });

  it('rejects a 2xx body outside the contract', async () => {
    const { client } = clientAnswering(jsonResponse(200, { id: 1 }));
    await expect(client.request('/tags/t1', { schema: tagSchema })).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it('wraps a failed fetch in a NetworkError', async () => {
    const { client } = clientFailingWith(new TypeError('Failed to fetch'));
    await expect(client.request('/tags')).rejects.toBeInstanceOf(NetworkError);
  });

  it('lets an abort pass through untouched', async () => {
    const { client } = clientFailingWith(new DOMException('Aborted', 'AbortError'));
    await expect(client.request('/tags')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
