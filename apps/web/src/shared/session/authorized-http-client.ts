import type { z } from 'zod';
import { ApiError, type HttpClient, type RequestOptions } from '@/shared/api';
import { type AccessToken, sameIdentity } from './access-token';
import { SessionChangedError, SessionEndedError } from './session-errors';

export interface AccessTokenProvider {
  current(): AccessToken | undefined;
  /** A usable token; `rejected` is the one the API just refused, so it is never handed back. */
  renew(rejected: string | undefined): Promise<AccessToken>;
}

/** Receives every API error of an authorized request, so the session can react (expired, blocked, MFA). */
export interface SessionErrorSink {
  report(error: ApiError): void;
}

type AnyRequestOptions = RequestOptions & { readonly schema?: z.ZodType };
type SendRequest = (path: string, options: AnyRequestOptions) => Promise<unknown>;

const UNAUTHORIZED = 401;

/**
 * Adds the bearer token. A 401 renews once and retries once (the guard rejects before any handler runs,
 * so retrying any method is safe). An answer that arrives after the person or organization changed is dropped.
 */
export function createAuthorizedHttpClient(transport: HttpClient, tokens: AccessTokenProvider, sink: SessionErrorSink): HttpClient {
  const send = transport.request as SendRequest;

  async function sendWith(token: AccessToken, path: string, options: AnyRequestOptions): Promise<unknown> {
    const result = await send(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token.value}` } });
    if (!sameIdentity(tokens.current()?.identity, token.identity)) throw new SessionChangedError();
    return result;
  }

  async function request(path: string, options: AnyRequestOptions = {}): Promise<unknown> {
    const token = tokens.current() ?? (await tokens.renew(undefined));
    try {
      return await sendWith(token, path, options);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status !== UNAUTHORIZED) {
        sink.report(error);
        throw error;
      }
    }
    return retryAfterRenewal(token, path, options);
  }

  async function retryAfterRenewal(rejected: AccessToken, path: string, options: AnyRequestOptions): Promise<unknown> {
    const fresh = await tokens.renew(rejected.value);
    try {
      return await sendWith(fresh, path, options);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      sink.report(error);
      throw error.status === UNAUTHORIZED ? new SessionEndedError() : error;
    }
  }

  return { request } as HttpClient;
}
