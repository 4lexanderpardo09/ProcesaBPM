import { ERROR_CODES, type MeResponse, supportSessionResponseSchema, type SupportSessionResponse } from '@procesabpm/shared';
import type { QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { ApiError, createQueryClient, type HttpClient, type RequestOptions } from '@/shared/api';
import { decodeIdentity, SessionEndedError, type SessionManager, type SessionState } from '@/shared/session';

/** Why a visit ended: closed from the console, the organization's access ended (revoked, expired), or the console session ended. */
export type VisitEndReason = 'closed' | 'accessEnded' | 'platformEnded';

export interface SupportVisitTenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** What the visit shows where a member's name and role go (the visitor is not a member, so the API has no profile for them). */
export interface VisitorLabels {
  readonly firstName: string;
  readonly lastName: string;
  readonly role: string;
}

export interface SupportVisit {
  readonly tenant: SupportVisitTenant;
  /** Stands in for the organization's session while the visit lasts: the same screens, over the support token. */
  readonly session: SessionManager;
  /** Its own cache: nothing read in the visit mixes with the member session of the same browser, and it is dropped at the end. */
  readonly queryClient: QueryClient;
  /** When the access the organization gave ends. */
  grantExpiresAt(): string;
  endedBecause(): VisitEndReason | undefined;
  /** Called once, when the visit ends for whatever reason. */
  onEnd(listener: (reason: VisitEndReason) => void): () => void;
  /** Closes it on the API (best effort) and here. */
  close(): Promise<void>;
  /** Ends it here only: the console session is gone, so the API ends the visit by itself. */
  end(reason: VisitEndReason): void;
}

export interface OpenSupportVisitDeps {
  /** The console's client (platform token): it opens, renews and closes the visit. */
  readonly platform: HttpClient;
  /** The plain transport the visit's requests go through, with the support token. */
  readonly transport: HttpClient;
  readonly tenant: SupportVisitTenant;
  readonly labels: VisitorLabels;
  readonly createQueryClient?: () => QueryClient;
}

type AnyOptions = RequestOptions & { readonly schema?: z.ZodType; readonly responseType?: 'blob' };
type SendRequest = (path: string, options: AnyOptions) => Promise<unknown>;

const NIL_ROLE_ID = '00000000-0000-4000-8000-000000000000';
const pathnameOf = (path: string) => path.split('?')[0] ?? path;
const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401;

const sessionsPath = (tenantId: string) => `/platform/tenants/${encodeURIComponent(tenantId)}/support-sessions`;

/**
 * Opens a read-only visit to an organization that granted support access (403 `SUPPORT_ACCESS_NOT_GRANTED` if it did
 * not). The API gives a token of at most 15 minutes; when one is refused the visit opens again while the grant lasts,
 * and ends when the grant does, when the organization revokes it, or when the console session ends.
 */
export async function openSupportVisit({ platform, transport, tenant, labels, createQueryClient: newQueryClient = createQueryClient }: OpenSupportVisitDeps): Promise<SupportVisit> {
  const openOnApi = () => platform.request(sessionsPath(tenant.id), { method: 'POST', schema: supportSessionResponseSchema });
  let current: SupportSessionResponse = await openOnApi();
  const identity = decodeIdentity(current.accessToken);
  if (identity === undefined) throw new Error('The support token has no session claims');

  const queryClient = newQueryClient();
  const state: SessionState = { status: 'signedIn', identity };
  const listeners = new Set<(reason: VisitEndReason) => void>();
  let ended: VisitEndReason | undefined;
  let renewing: Promise<SupportSessionResponse> | undefined;

  const end = (reason: VisitEndReason) => {
    if (ended !== undefined) return;
    ended = reason;
    void queryClient.cancelQueries();
    queryClient.clear();
    listeners.forEach((listener) => listener(reason));
  };

  const closeOnApi = (sessionId: string) => platform.request(`${sessionsPath(tenant.id)}/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => undefined);

  /** A new token for the one the API refused; one renewal at a time, however many requests were refused together. */
  function renew(rejected: SupportSessionResponse): Promise<SupportSessionResponse> {
    if (current !== rejected) return Promise.resolve(current);
    renewing ??= openOnApi()
      .then((opened) => {
        current = opened;
        void closeOnApi(rejected.sessionId);
        return opened;
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && (error.code === ERROR_CODES.supportAccessNotGranted || error.status === 404)) end('accessEnded');
        else if (isUnauthenticated(error)) end('platformEnded');
        throw ended === undefined ? error : new SessionEndedError();
      })
      .finally(() => {
        renewing = undefined;
      });
    return renewing;
  }

  const send = (token: SupportSessionResponse, path: string, options: AnyOptions) =>
    (transport.request as SendRequest)(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token.accessToken}` } });

  /** The profile of the visitor, which the API refuses to someone who is not a member: built here, never asked for. */
  const profile = (): MeResponse => ({
    user: { id: identity.userId, email: '', firstName: labels.firstName, lastName: labels.lastName, locale: 'es', timeZone: null, mfaEnabled: true, emailVerifiedAt: null },
    membership: { tenantId: tenant.id, status: 'ACTIVE', isOwner: false, role: { id: NIL_ROLE_ID, name: labels.role, isAdmin: false }, companies: [], signatureFileId: null },
    organization: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    tenantMode: 'ACTIVE',
  });

  async function request(path: string, options: AnyOptions = {}): Promise<unknown> {
    if (ended !== undefined) throw new SessionEndedError();
    if (pathnameOf(path) === '/auth/me') {
      const me = profile();
      return options.schema === undefined ? me : options.schema.parse(me);
    }
    const token = current;
    try {
      return await send(token, path, options);
    } catch (error) {
      if (!isUnauthenticated(error)) throw error;
    }
    const fresh = await renew(token);
    try {
      return await send(fresh, path, options);
    } catch (error) {
      if (isUnauthenticated(error)) {
        end('accessEnded');
        throw new SessionEndedError();
      }
      throw error;
    }
  }

  const client = { request } as HttpClient;
  const session: SessionManager = {
    getState: () => state,
    subscribe: () => () => undefined,
    start: () => undefined,
    retry: () => undefined,
    establish: () => Promise.reject(new Error('A support visit cannot open another session')),
    signOut: () => close(),
    client,
    publicClient: transport,
    dispose: () => undefined,
  };

  async function close() {
    if (ended !== undefined) return;
    await closeOnApi(current.sessionId);
    end('closed');
  }

  return {
    tenant,
    session,
    queryClient,
    grantExpiresAt: () => current.grantExpiresAt,
    endedBecause: () => ended,
    onEnd(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close,
    end,
  };
}
