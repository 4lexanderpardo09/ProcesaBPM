import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { bearer, signIn } from './auth-helpers.js';
import { seedUser } from './auth-fixtures.js';
import { grantEverything, seedRole, setRolePermissions, type GrantedPermission } from './permission-fixtures.js';

export type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** Thin supertest wrapper bound to one access token. */
export class ApiClient {
  constructor(
    private readonly app: INestApplication,
    private readonly token: string,
  ) {}

  /** The bearer token, for clients other than HTTP (a socket's handshake). */
  get accessToken(): string {
    return this.token;
  }

  call(method: Method, path: string, body?: unknown): request.Test {
    const call = request(this.app.getHttpServer())[method](path).set(bearer(this.token));
    return body === undefined ? call : call.send(body as object);
  }

  get = (path: string) => this.call('get', path);
  post = (path: string, body?: unknown) => this.call('post', path, body);
  patch = (path: string, body: unknown) => this.call('patch', path, body);
  put = (path: string, body: unknown) => this.call('put', path, body);
  delete = (path: string) => this.call('delete', path);
}

export interface AdminWorld {
  readonly db: TestDatabase;
  readonly tenant: SeededTenant;
  readonly admin: ApiClient;
}

/** A tenant whose role has `manage all`, and a client signed in as one of its members. */
export async function adminOf(db: TestDatabase, app: INestApplication, tenant?: SeededTenant): Promise<{ tenant: SeededTenant; admin: ApiClient }> {
  const seeded = tenant ?? (await seedTenant(db.platform));
  await grantEverything(db, seeded);
  return { tenant: seeded, admin: await clientOf(db, app, seeded) };
}

/** A member of the tenant with the tenant's own role (full access in `adminOf`). */
export async function clientOf(db: TestDatabase, app: INestApplication, tenant: SeededTenant, options: { roleId?: string; departmentId?: string } = {}): Promise<ApiClient> {
  const user = await seedUser(db, tenant, undefined, options);
  return new ApiClient(app, (await signIn(app, user.email, tenant.tenantId)).accessToken);
}

/** A member whose role grants exactly `granted`. */
export async function clientWith(db: TestDatabase, app: INestApplication, tenant: SeededTenant, granted: readonly GrantedPermission[], name = `Role ${Math.random()}`): Promise<ApiClient> {
  const roleId = await seedRole(db, tenant.tenantId, name);
  await setRolePermissions(db, tenant.tenantId, roleId, granted);
  return clientOf(db, app, tenant, { roleId });
}

export { connectTestDatabase };
