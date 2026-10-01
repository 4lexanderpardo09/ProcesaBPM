import type { INestApplication } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from '../../src/common/auth/public.decorator.js';
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
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/password-reset/request',
  'POST /auth/password-reset/confirm',
  'POST /auth/invitations/accept',
  'GET /test/public-companies',
];

interface Route {
  readonly method: string;
  readonly path: string;
  readonly isPublic: boolean;
}

const normalize = (...parts: unknown[]) =>
  `/${parts.flatMap((part) => (typeof part === 'string' ? part.split('/') : [])).filter(Boolean).join('/')}`;

/** Every route declared by a controller, read from the Nest metadata. */
function declaredRoutes(app: INestApplication): Route[] {
  const routes: Route[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (controller === null) continue;
      const prefix: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler: unknown = controller.prototype[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (path === undefined || typeof method !== 'number') continue;
        routes.push({
          method: RequestMethod[method]!,
          path: normalize(prefix, path),
          isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        });
      }
    }
  }
  return routes;
}

/** What Express actually serves, to make sure the metadata walk did not miss anything. */
function servedRoutes(app: INestApplication): string[] {
  const express = app.getHttpAdapter().getInstance() as { router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } };
  return express.router.stack.flatMap((layer) =>
    layer.route ? Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route!.path}`) : [],
  );
}

describe('route protection (deny by default)', () => {
  let app: INestApplication;
  let routes: Route[];

  beforeAll(async () => {
    ({ app } = await createTestApp({ controllers: [TenantProbeController] }));
    routes = declaredRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('the metadata walk finds every route Express serves', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual(servedRoutes(app).sort());
  });

  it('only the expected routes are public', () => {
    expect(routes.filter((route) => route.isPublic).map((route) => `${route.method} ${route.path}`).sort()).toEqual(
      [...PUBLIC_ROUTES].sort(),
    );
  });

  it('every other route answers 401 without a token and with a bad one', async () => {
    const protectedRoutes = routes.filter((route) => !route.isPublic);
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const route of protectedRoutes) {
      const path = route.path.replace(/:[^/]+/g, '018f3c1e-7b2a-7c3d-9e4f-0123456789ab');
      for (const authorization of [undefined, 'Bearer not.a.token']) {
        const call = request(app.getHttpServer())[route.method.toLowerCase() as 'get'](path);
        const response = await (authorization === undefined ? call : call.set('authorization', authorization));
        expect({ route: `${route.method} ${route.path}`, status: response.status, code: response.body?.error?.code }).toEqual({
          route: `${route.method} ${route.path}`,
          status: 401,
          code: 'UNAUTHENTICATED',
        });
      }
    }
  });
});
