import type { z } from 'zod';
import { apiErrorFrom, NetworkError, UnexpectedResponseError } from './api-error';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  readonly method?: HttpMethod;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface HttpClient {
  /** Parses the 2xx body with its contract (from `@procesabpm/shared`). */
  request<TSchema extends z.ZodType>(path: string, options: RequestOptions & { readonly schema: TSchema }): Promise<z.infer<TSchema>>;
  /** For responses whose body is not used. */
  request(path: string, options?: RequestOptions): Promise<void>;
}

export interface HttpClientConfig {
  readonly baseUrl: string;
  readonly fetchFn?: typeof fetch;
}

type AnyRequestOptions = RequestOptions & { readonly schema?: z.ZodType };

const NO_CONTENT = 204;

/**
 * JSON over fetch against the API. Errors are typed: `ApiError` (the API answered with an error),
 * `NetworkError` (no answer) and `UnexpectedResponseError` (a 2xx body outside the contract).
 */
export function createHttpClient({ baseUrl, fetchFn = (...args) => globalThis.fetch(...args) }: HttpClientConfig): HttpClient {
  const root = baseUrl.replace(/\/+$/, '');

  async function request(path: string, { method = 'GET', body, signal, schema }: AnyRequestOptions = {}): Promise<unknown> {
    const response = await send(fetchFn, `${root}${path}`, requestInit(method, body, signal));
    const payload = await readJson(response);
    if (!response.ok) throw apiErrorFrom(response.status, payload);
    if (schema === undefined) return undefined;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new UnexpectedResponseError(response.status, parsed.error);
    return parsed.data;
  }

  return { request } as HttpClient;
}

function requestInit(method: HttpMethod, body: unknown, signal: AbortSignal | undefined): RequestInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return {
    method,
    credentials: 'same-origin',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  };
}

async function send(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new NetworkError(error);
  }
}

/** Checked by name: fetch may throw a DOMException from another realm (e.g. Node's inside jsdom). */
function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === NO_CONTENT) return undefined;
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
