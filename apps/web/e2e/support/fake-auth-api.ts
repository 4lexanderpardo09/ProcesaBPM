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
  /** The tickets each inbox view holds; a missing view is empty. */
  readonly tickets?: Readonly<Partial<Record<'assigned' | 'created' | 'observed' | 'all', readonly FakeTicket[]>>>;
}

export interface FakeTicket {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly tags?: readonly { readonly id: string; readonly name: string; readonly color: string }[];
  /** Sanitized HTML, as the API keeps it. */
  readonly descriptionHtml?: string;
  /** What the signed-in person may do (`actions` of the detail); by default only comment. */
  readonly actions?: Partial<Record<'advance' | 'take' | 'reassign' | 'close' | 'openIncident' | 'resolveIncident' | 'reopen' | 'signParallelTask' | 'comment' | 'edit', boolean>>;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly search: URLSearchParams;
  readonly authorization: string | undefined;
  /** The JSON body sent, `{}` when there is none. */
  readonly body: Record<string, unknown>;
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = (userId: string, tenantId: string, sessionId: string) => `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, tid: tenantId, sid: sessionId, aud: 'procesabpm:api' })}.fake`;

const USER_ID = '018f0000-0000-7000-8000-000000000001';
const STEP_ID = '018f0000-0000-7000-8000-0000000000d1';
const TICKET_PATH = /^\/api\/tickets\/([^/]+)(?:\/(form|timeline|documents|comments|flow|candidates|reassign))?$/;
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
    tenantStatus: 'ACTIVE',
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

  const ticketPage = (search: URLSearchParams) => {
    const view = (search.get('view') ?? 'assigned') as keyof NonNullable<FakeAuthApiOptions['tickets']>;
    const status = search.get('status');
    const page = Number(search.get('page') ?? 1);
    const pageSize = Number(search.get('pageSize') ?? 25);
    const matching = (options.tickets?.[view] ?? []).filter((ticket) => status === null || ticket.status === status);
    const items = matching.slice((page - 1) * pageSize, page * pageSize).map((ticket) => ({
      companyId: '018f0000-0000-7000-8000-0000000000c1',
      creatorId: USER_ID,
      subcategoryId: '018f0000-0000-7000-8000-0000000000c2',
      currentStepId: null,
      priorityId: null,
      createdAt: '2026-10-17T15:00:00.000Z',
      closedAt: null,
      tags: [],
      creator: { id: USER_ID, name: 'Ana Pérez' },
      subcategory: { id: '018f0000-0000-7000-8000-0000000000c2', name: 'Pagos', category: { id: '018f0000-0000-7000-8000-0000000000c3', name: 'Cartera' } },
      currentStep: null,
      priority: null,
      assignees: [],
      sla: null,
      ...ticket,
    }));
    return { items, page, pageSize, total: matching.length };
  };

  const findTicket = (ticketId: string) =>
    Object.values(options.tickets ?? {})
      .flat()
      .find((ticket) => ticket.id === ticketId);
  /** Comments added during the test, per ticket: the timeline answers with them after the creation event. */
  const comments = new Map<string, { id: string; commentHtml: string; createdAt: string }[]>();
  /** Who each ticket was reassigned to during the test: the detail answers with them as its holder. */
  const reassigned = new Map<string, string>();

  const ticketDetail = (ticket: FakeTicket) => ({
    companyId: '018f0000-0000-7000-8000-0000000000c1',
    creatorId: USER_ID,
    subcategoryId: '018f0000-0000-7000-8000-0000000000c2',
    currentStepId: STEP_ID,
    createdAt: '2026-10-17T15:00:00.000Z',
    closedAt: null,
    tags: [],
    creator: { id: USER_ID, name: 'Ana Pérez' },
    subcategory: { id: '018f0000-0000-7000-8000-0000000000c2', name: 'Pagos', category: { id: '018f0000-0000-7000-8000-0000000000c6', name: 'Cartera' } },
    currentStep: { id: STEP_ID, name: 'Revisión' },
    priority: null,
    sla: null,
    ...ticket,
    workflowId: '018f0000-0000-7000-8000-0000000000c3',
    workflowVersionId: '018f0000-0000-7000-8000-0000000000c4',
    registeredById: null,
    descriptionHtml: ticket.descriptionHtml ?? '',
    priorityId: null,
    departmentId: null,
    siteId: null,
    currentLoop: 0,
    closedById: null,
    openVisit: { id: '018f0000-0000-7000-8000-0000000000c5', stepId: STEP_ID, loop: 0, enteredAt: '2026-10-17T15:00:00.000Z', dueAt: null },
    assignees: reassigned.has(ticket.id)
      ? [{ userId: reassigned.get(ticket.id) ?? '', name: 'Marta Ruiz', type: 'PRIMARY', assignedAt: '2026-10-17T16:00:00.000Z' }]
      : [{ userId: USER_ID, name: 'Ana Pérez', type: 'PRIMARY', assignedAt: '2026-10-17T15:00:00.000Z' }],
    awaitingDispatch: false,
    parallelTasks: [],
    openIncident: null,
    waitingUntil: null,
    values: {},
    totals: {},
    company: { id: '018f0000-0000-7000-8000-0000000000c1', name: 'Electrocréditos' },
    registeredBy: null,
    closedBy: null,
    department: null,
    site: null,
    valueNames: { users: {}, sites: {}, companies: {}, departments: {}, positions: {} },
    actions: { advance: false, take: false, reassign: false, close: false, openIncident: false, resolveIncident: false, reopen: false, signParallelTask: false, comment: true, reportError: false, edit: false, ...ticket.actions },
  });

  const event = (id: string, type: string, commentHtml: string | null, createdAt: string) => ({
    id,
    type,
    stepId: STEP_ID,
    transitionId: null,
    loop: 0,
    actorId: USER_ID,
    assigneeId: null,
    commentHtml,
    data: {},
    createdAt,
    actor: { id: USER_ID, name: 'Ana Pérez' },
    assignee: null,
    step: { id: STEP_ID, name: 'Revisión' },
    transition: null,
  });

  const ticketResource = (route: Route, ticket: FakeTicket, resource: string | undefined, method: string, body: Record<string, unknown>) => {
    const key = `${method} ${resource ?? ''}`;
    switch (key) {
      case 'GET ':
        return json(route, 200, ticketDetail(ticket));
      case 'GET form':
        return json(route, 200, { ticketId: ticket.id, versionId: '018f0000-0000-7000-8000-0000000000c4', visitId: '018f0000-0000-7000-8000-0000000000c5', step: { id: STEP_ID, name: 'Revisión', type: 'TASK', description: null, closeRule: 'NOT_ALLOWED' }, fields: [], editableFieldCodes: [], decisions: [] });
      case 'GET timeline':
        return json(route, 200, [event('018f0000-0000-7000-8000-0000000000e0', 'CREATED', null, '2026-10-17T15:00:00.000Z'), ...(comments.get(ticket.id) ?? []).map((comment) => event(comment.id, 'COMMENTED', comment.commentHtml, comment.createdAt))]);
      case 'GET documents':
        return json(route, 200, []);
      case 'GET flow':
        return json(route, 200, {
          ticketId: ticket.id,
          versionId: '018f0000-0000-7000-8000-0000000000c4',
          status: 'OPEN',
          currentStepId: STEP_ID,
          steps: [
            { id: '018f0000-0000-7000-8000-0000000000d0', type: 'START', name: 'Inicio', position: { x: 0, y: 0 }, passCount: 1 },
            { id: STEP_ID, type: 'TASK', name: 'Revisión', position: { x: 220, y: 0 }, passCount: 1 },
            { id: '018f0000-0000-7000-8000-0000000000d2', type: 'END', name: 'Fin', position: { x: 440, y: 0 }, passCount: 0 },
          ],
          transitions: [
            { id: '018f0000-0000-7000-8000-0000000000d3', fromStepId: '018f0000-0000-7000-8000-0000000000d0', toStepId: STEP_ID, type: 'DEFAULT', label: '', points: null, takenCount: 1 },
            { id: '018f0000-0000-7000-8000-0000000000d4', fromStepId: STEP_ID, toStepId: '018f0000-0000-7000-8000-0000000000d2', type: 'DECISION', label: 'Aprobar', points: null, takenCount: 0 },
          ],
        });
      case 'GET candidates':
        return json(route, 200, [{ id: '018f0000-0000-7000-8000-0000000000f1', name: 'Marta Ruiz' }]);
      case 'POST reassign':
        reassigned.set(ticket.id, String(body.toUserId));
        return json(route, 200, { id: ticket.id, number: ticket.number, status: ticket.status, currentStepId: STEP_ID, openVisitId: '018f0000-0000-7000-8000-0000000000c5' });
      case 'POST comments': {
        const list = comments.get(ticket.id) ?? [];
        const id = `018f0000-0000-7000-8000-0000000000e${list.length + 1}`;
        comments.set(ticket.id, [...list, { id, commentHtml: String(body.comment), createdAt: new Date().toISOString() }]);
        return json(route, 201, { eventId: id });
      }
      default:
        return error(route, 404, 'NOT_FOUND');
    }
  };

  const handlers: Record<string, (route: Route, body: Record<string, unknown>, authorization: string | undefined, search: URLSearchParams) => Promise<void>> = {
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
        organization: { id: sessionTenant, slug: nameOf(sessionTenant).toLowerCase(), name: nameOf(sessionTenant) },
        tenantMode: 'ACTIVE',
      });
    },
    // An administrator: every section of the menu shows.
    'GET /api/auth/me/permissions': (route, _body, authorization) => {
      if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
      return json(route, 200, { permissions: [{ action: 'manage', subject: 'all', conditional: false }] });
    },
    // The bell in the top bar: nothing unread.
    'GET /api/notifications/unread-count': (route, _body, authorization) => {
      if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
      return json(route, 200, { count: 0 });
    },
    'GET /api/tickets': (route, _body, authorization, search) => {
      if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
      return json(route, 200, ticketPage(search));
    },
    // How many tickets each tab holds, under the same status filter as the listing.
    'GET /api/tickets/counts': (route, _body, authorization, search) => {
      if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
      const status = search.get('status');
      const count = (view: 'assigned' | 'created' | 'observed' | 'all') => (options.tickets?.[view] ?? []).filter((ticket) => status === null || ticket.status === status).length;
      return json(route, 200, { assigned: count('assigned'), created: count('created'), observed: count('observed'), all: count('all'), history: 0, reopened: 0, errors_reported: 0, errors_received: 0 });
    },
    // The home: the counters and nothing pending.
    'GET /api/dashboard/stats': (route, _body, authorization) => {
      if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
      return json(route, 200, { myOpen: 0, myOverdue: 0, myDueSoon: 0, createdByMeOpen: 0, closedByMeWeek: 0 });
    },
    'GET /api/dashboard/pending': (route, _body, authorization) => {
      if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
      return json(route, 200, []);
    },
  };

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname: path, searchParams: search } = new URL(request.url());
    const authorization = request.headers().authorization;
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    requests.push({ method: request.method(), path, search, authorization, body });
    const handler = handlers[`${request.method()} ${path}`];
    if (handler !== undefined) return handler(route, body, authorization, search);
    const ticketMatch = TICKET_PATH.exec(path);
    if (ticketMatch === null) return error(route, 404, 'NOT_FOUND');
    if (validToken === undefined || authorization !== `Bearer ${validToken}`) return error(route, 401, 'UNAUTHENTICATED');
    const ticket = findTicket(decodeURIComponent(ticketMatch[1] ?? ''));
    return ticket === undefined ? error(route, 404, 'NOT_FOUND') : ticketResource(route, ticket, ticketMatch[2], request.method(), body);
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
