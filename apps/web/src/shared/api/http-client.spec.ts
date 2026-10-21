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

  it('adds the per-request headers', async () => {
    const { client, fetchFn } = clientAnswering(jsonResponse(200, []));
    await client.request('/auth/me', { headers: { Authorization: 'Bearer t' } });
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({ Accept: 'application/json', Authorization: 'Bearer t' });
  });

  it('reads Retry-After into the ApiError', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'x' } }), { status: 429, headers: { 'Retry-After': '42' } });
    const { client } = clientAnswering(response);
    await expect(client.request('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 42 });
  });

  it('hands a file body back as it came, and still reads an error as JSON', async () => {
    const pdf = await clientAnswering(new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } })).client.request('/preview', { method: 'POST', responseType: 'blob' });
    expect(pdf).toBeInstanceOf(Blob);
    expect(await pdf.text()).toBe('%PDF-1.7');

    const refused = clientAnswering(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'x' } })).client.request('/preview', { method: 'POST', responseType: 'blob' });
    await expect(refused).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
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
