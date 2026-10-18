import type { BrowserContext, Route } from '@playwright/test';

export interface FakeOrganization {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly membershipStatus?: 'ACTIVE' | 'INVITED';
  readonly maintenance?: { readonly title: string; readonly endsAt: string | null } | null;
}

export type LoginBehaviour =
  | { readonly kind: 'select' }
  | { readonly kind: 'mfa'; readonly code: string }
  | { readonly kind: 'enroll'; readonly code: string }
  | { readonly kind: 'error'; readonly status: number; readonly code: string; readonly headers?: Record<string, string> };

export interface FakeAuthApiOptions {
  readonly organizations: readonly FakeOrganization[];
  readonly login?: LoginBehaviour;
  /** A refresh cookie already exists when the page loads (the person signed in before). */
  readonly signedInTo?: string;
  readonly password?: string;
  readonly expiresIn?: number;
  readonly refusedTenants?: Readonly<Record<string, { readonly status: number; readonly code: string }>>;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = (userId: string, tenantId: string, sessionId: string) => `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, tid: tenantId, sid: sessionId, aud: 'procesabpm:api' })}.fake`;

const USER_ID = '018f0000-0000-7000-8000-000000000001';
export const SECRET = 'JBSWY3DPEHPK3PXP';
export const BACKUP_CODES = Array.from({ length: 10 }, (_, index) => `K7QM-2XPA-9RTD-4F${index}Z`);

/**
 * A stateful stand-in for the auth API, shared by every page of one browser context (one browser profile).
 * The refresh "cookie" is its server-side state: each refresh rotates the session and only the newest access
 * token is accepted, like the real API. It counts calls and records the bearer of every request.
 */
export async function installFakeAuthApi(context: BrowserContext, options: FakeAuthApiOptions) {
  const password = options.password ?? 'correct horse battery';
  const expiresIn = options.expiresIn ?? 900;
  let sessionTenant: string | undefined = options.signedInTo;
  let generation = 0;
  let validToken: string | undefined;
  const requests: RecordedRequest[] = [];
  const counts = { refresh: 0, selectTenant: 0, logout: 0, enrollmentStarted: 0 };

  const organizationsJson = options.organizations.map((organization) => ({
    membershipStatus: 'ACTIVE',
    mfaRequired: false,
    maintenance: null,
    ...organization,
  }));
  const selection = (extra: object = {}) => ({ step: 'SELECT_ORGANIZATION', organizations: organizationsJson, selectionToken: 'selection-token', expiresIn: 120, platformAdmin: false, ...extra });

  const openSession = (tenantId: string) => {
    sessionTenant = tenantId;
    generation += 1;
    validToken = accessToken(USER_ID, tenantId, `session-${generation}`);
    return { accessToken: validToken, tokenType: 'Bearer', expiresIn };
  };

  const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: 'application/json', headers, body: body === undefined ? '' : JSON.stringify(body) });
  const error = (route: Route, status: number, code: string, headers: Record<string, string> = {}) => json(route, status, { error: { code, message: code, requestId: 'req-e2e' } }, headers);

  const nameOf = (tenantId: string | undefined) => options.organizations.find((organization) => organization.tenantId === tenantId)?.name ?? '?';

  const handlers: Record<string, (route: Route, body: Record<string, unknown>, authorization: string | undefined) => Promise<void>> = {
    'POST /api/auth/login': (route, body) => {
      if (body.password !== password) return error(route, 401, 'INVALID_CREDENTIALS');
      const behaviour = options.login ?? { kind: 'select' };
      if (behaviour.kind === 'error') return error(route, behaviour.status, behaviour.code, behaviour.headers);
      if (behaviour.kind === 'mfa') return json(route, 200, { step: 'MFA_REQUIRED', challengeToken: 'challenge-token', expiresIn: 300, methods: ['TOTP', 'BACKUP_CODE'] });
      if (behaviour.kind === 'enroll') return json(route, 200, { step: 'MFA_ENROLLMENT_REQUIRED', challengeToken: 'challenge-token', expiresIn: 300, reason: 'TENANT_POLICY' });
      return json(route, 200, selection());
    },
    'POST /api/auth/login/mfa': (route, body, authorization) => {
      const behaviour = options.login;
      if (authorization !== 'Bearer challenge-token' || behaviour?.kind !== 'mfa') return error(route, 401, 'UNAUTHENTICATED');
      if (body.code !== behaviour.code) return error(route, 401, 'INVALID_MFA_CODE');
      return json(route, 200, selection());
    },
    'POST /api/auth/login/mfa/enrollment': (route) => {
      counts.enrollmentStarted += 1;
      return json(route, 200, { secret: SECRET, otpauthUri: `otpauth://totp/ProcesaBPM:ana@example.com?secret=${SECRET}&issuer=ProcesaBPM`, issuer: 'ProcesaBPM', accountName: 'ana@example.com', algorithm: 'SHA1', digits: 6, period: 30 });
    },
    'POST /api/auth/login/mfa/enrollment/confirm': (route, body) => {
      const behaviour = options.login;
      if (behaviour?.kind !== 'enroll' || body.code !== behaviour.code) return error(route, 401, 'INVALID_MFA_CODE');
      return json(route, 200, { ...selection(), backupCodes: BACKUP_CODES });
    },
    'POST /api/auth/select-tenant': (route, body, authorization) => {
      counts.selectTenant += 1;
      if (authorization !== 'Bearer selection-token') return error(route, 401, 'UNAUTHENTICATED');
      const tenantId = String(body.tenantId);
      const refusal = options.refusedTenants?.[tenantId];
      if (refusal !== undefined) return error(route, refusal.status, refusal.code);
      return json(route, 200, openSession(tenantId));
    },
    'POST /api/auth/refresh': (route) => {
      counts.refresh += 1;
      if (sessionTenant === undefined) return error(route, 401, 'UNAUTHENTICATED');
      return json(route, 200, openSession(sessionTenant));
    },
    'POST /api/auth/logout': (route) => {
      counts.logout += 1;
      sessionTenant = undefined;
      validToken = undefined;
      return route.fulfill({ status: 204, body: '' });
    },
    'GET /api/auth/me': (route, _body, authorization) => {
      if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
      return json(route, 200, {
        user: { id: USER_ID, email: 'ana@example.com', firstName: 'Ana', lastName: 'Torres', locale: 'es-CO', timeZone: null, mfaEnabled: false, emailVerifiedAt: null },
        membership: { tenantId: sessionTenant, status: 'ACTIVE', isOwner: false, role: { id: '018f0000-0000-7000-8000-000000000003', name: `Analista de ${nameOf(sessionTenant)}`, isAdmin: false }, companies: [], signatureFileId: null },
        tenantMode: 'ACTIVE',
      });
    },
  };

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const authorization = request.headers().authorization;
    requests.push({ method: request.method(), path, authorization });
    const handler = handlers[`${request.method()} ${path}`];
    if (handler === undefined) return error(route, 404, 'NOT_FOUND');
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    return handler(route, body, authorization);
  });

  return {
    counts,
    requests,
    /** Ends the session on the "server", as a revocation or an expired cookie would. */
    revokeSession() {
      sessionTenant = undefined;
      validToken = undefined;
    },
    currentToken: () => validToken,
  };
}
