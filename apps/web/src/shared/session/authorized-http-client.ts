import { ERROR_CODES } from '@procesabpm/shared';
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

type AnyRequestOptions = RequestOptions & { readonly schema?: z.ZodType; readonly responseType?: 'blob' };
type SendRequest = (path: string, options: AnyRequestOptions) => Promise<unknown>;

/** Only this means the access token itself was refused; other 401s (a wrong current password, a wrong code) are answers. */
const isExpiredToken = (error: ApiError) => error.status === 401 && error.code === ERROR_CODES.unauthenticated;

/**
 * Adds the bearer token. An expired token is renewed once and the request retried once (the guard rejects before
 * any handler runs, so retrying is safe). Every request stays pinned to the identity it was sent under: if the person
 * or organization changed meanwhile, its answer, its error and its retry are dropped instead of reaching the new one.
 */
export function createAuthorizedHttpClient(transport: HttpClient, tokens: AccessTokenProvider, sink: SessionErrorSink): HttpClient {
  const send = transport.request as SendRequest;
  const assertStillCurrent = (token: AccessToken) => {
    if (!sameIdentity(tokens.current()?.identity, token.identity)) throw new SessionChangedError();
  };

  async function sendWith(token: AccessToken, path: string, options: AnyRequestOptions): Promise<unknown> {
    try {
      const result = await send(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token.value}` } });
      assertStillCurrent(token);
      return result;
    } catch (error) {
      if (error instanceof ApiError) assertStillCurrent(token);
      throw error;
    }
  }

  async function request(path: string, options: AnyRequestOptions = {}): Promise<unknown> {
    const token = tokens.current() ?? (await tokens.renew(undefined));
    try {
      return await sendWith(token, path, options);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (!isExpiredToken(error)) {
        sink.report(error);
        throw error;
      }
    }
    return retryAfterRenewal(token, path, options);
  }

  async function retryAfterRenewal(rejected: AccessToken, path: string, options: AnyRequestOptions): Promise<unknown> {
    const fresh = await tokens.renew(rejected.value);
    if (!sameIdentity(fresh.identity, rejected.identity)) throw new SessionChangedError();
    try {
      return await sendWith(fresh, path, options);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      sink.report(error);
      throw isExpiredToken(error) ? new SessionEndedError() : error;
    }
  }

  return { request } as HttpClient;
}
