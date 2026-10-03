import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRoutes, type RouteInfo } from '../../src/common/auth/route-metadata.js';
import { createTestApp } from '../support/create-test-app.js';
import { TenantProbeController } from '../support/test-controllers.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

/** Adding a route here must be a deliberate decision: everything else requires an access token. */
const PUBLIC_ROUTES = [
  'GET /health',
  'GET /ready',
  'POST /auth/login',
  'POST /auth/select-tenant',
  'POST /auth/platform/select',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/login/mfa',
  'POST /auth/login/mfa/enrollment',
  'POST /auth/login/mfa/enrollment/confirm',
  'POST /auth/password-reset/request',
  'POST /auth/password-reset/confirm',
  'POST /auth/invitations/accept',
  'GET /test/public-companies',
];

/** Routes that need a signed-in user but no permission of the catalog. */
const AUTHENTICATED_ONLY_ROUTES = [
  'POST /auth/password',
  'GET /auth/me',
  'GET /auth/mfa',
  'POST /auth/mfa/enrollment',
  'POST /auth/mfa/enrollment/confirm',
  'POST /auth/mfa/disable',
  'POST /auth/mfa/backup-codes',
  'GET /delegations',
  'POST /delegations',
  'POST /delegations/:id/cancel',
  'GET /notifications',
  'GET /notifications/unread-count',
  'GET /notifications/preferences',
  'PUT /notifications/preferences/:type',
  'POST /notifications/read-all',
  'POST /notifications/:id/read',
];

/** Routes of the platform administrators: they need a platform token, never a tenant one. */
const PLATFORM_ROUTES = [
  'POST /auth/platform/logout',
  'POST /platform/tenants',
  'POST /platform/tenants/:id/suspend',
  'POST /platform/tenants/:id/reactivate',
  'GET /platform/tenants',
  'GET /platform/tenants/:id',
  'PUT /platform/tenants/:id/plan',
  'PUT /platform/tenants/:id/extra-storage',
  'POST /platform/tenants/:id/owner-invitation',
  'GET /platform/admins',
  'POST /platform/admins',
  'DELETE /platform/admins/:userId',
];

/** Administrative subjects: a route that changes one must declare `@Audited` (or `@NotAudited` with the reason). */
const AUDITED_SUBJECTS = new Set(['Membership', 'Role', 'Group', 'ApprovalGroup', 'Workflow', 'Setting']);

/** Test routes that exist to prove the deny-by-default behaviour: they declare nothing on purpose. */
const INTENTIONALLY_UNDECLARED = ['GET /test/undeclared'];

const label = (route: RouteInfo) => `${route.method} ${route.path}`;

/** What Express actually serves, to make sure the metadata walk did not miss anything. */
function servedRoutes(app: INestApplication): string[] {
  const express = app.getHttpAdapter().getInstance() as { router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } };
  return express.router.stack.flatMap((layer) =>
    layer.route ? Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route!.path}`) : [],
  );
}

describe('route protection (deny by default)', () => {
  let app: INestApplication;
  let productionApp: INestApplication;
  let routes: RouteInfo[];
  let productionRoutes: RouteInfo[];

  beforeAll(async () => {
    ({ app } = await createTestApp({ controllers: [TenantProbeController] }));
    routes = collectRoutes(app.get(ModulesContainer));
    ({ app: productionApp } = await createTestApp());
    productionRoutes = collectRoutes(productionApp.get(ModulesContainer));
  });

  afterAll(async () => {
    await app.close();
    await productionApp.close();
  });

  it('the metadata walk finds every route Express serves', () => {
    expect(routes.map(label).sort()).toEqual(servedRoutes(app).sort());
  });

  it('only the expected routes are public', () => {
    expect(routes.filter((route) => route.access === 'public').map(label).sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('only the expected routes are authenticated-only', () => {
    expect(routes.filter((route) => route.access === 'authenticated-only').map(label)).toEqual(AUTHENTICATED_ONLY_ROUTES);
  });

  it('only the expected routes are platform-only, and every /platform route is one of them', () => {
    expect(routes.filter((route) => route.access === 'platform').map(label).sort()).toEqual([...PLATFORM_ROUTES].sort());
    expect(routes.filter((route) => route.path.startsWith('/platform')).every((route) => route.access === 'platform')).toBe(true);
  });

  it('every other route of the application declares a permission, and none mixes declarations', () => {
    const undeclared = routes.filter((route) => route.access === 'undeclared').map(label);
    expect(undeclared).toEqual(INTENTIONALLY_UNDECLARED);
    expect(routes.filter((route) => route.access === 'conflict').map(label)).toEqual([]);
    for (const route of routes.filter((candidate) => candidate.access === 'permission')) {
      expect(route.requirement!.actions.length, label(route)).toBeGreaterThan(0);
      expect(route.requirement!.subject, label(route)).not.toBe('');
    }
  });

  it('every route that changes data of an audited subject says which audit events it writes, or why it writes none', () => {
    const undecided = routes
      .filter((route) => route.access === 'permission' && route.method !== 'GET' && AUDITED_SUBJECTS.has(route.requirement!.subject))
      .filter((route) => route.audit === undefined)
      .map(label);
    expect(undecided).toEqual([]);
  });

  it('the real application (without the test routes) has no undeclared or conflicting route', () => {
    const problems = productionRoutes.filter((route) => route.access === 'undeclared' || route.access === 'conflict');
    expect(problems.map(label)).toEqual([]);
  });

  it('every route that is not public answers 401 without a token and with a bad one', async () => {
    const protectedRoutes = routes.filter((route) => route.access !== 'public');
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const route of protectedRoutes) {
      const path = route.path.replace(/:[^/]+/g, '018f3c1e-7b2a-7c3d-9e4f-0123456789ab');
      for (const authorization of [undefined, 'Bearer not.a.token']) {
        const call = request(app.getHttpServer())[route.method.toLowerCase() as 'get'](path);
        const response = await (authorization === undefined ? call : call.set('authorization', authorization));
        expect({ route: label(route), status: response.status, code: response.body?.error?.code }).toEqual({
          route: label(route),
          status: 401,
          code: 'UNAUTHENTICATED',
        });
      }
    }
  });
});
