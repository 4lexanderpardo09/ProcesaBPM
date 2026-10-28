import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { VersionDetailResponse } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceSpec } from '../../../../packages/shared/src/workflow/draft-spec/test-fixtures.js';
import { adminOf, type ApiClient, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

describe('POST /workflows/:id/versions/:id/import: a template replaces the draft, no AI involved', () => {
  let db: TestDatabase;
  let app: INestApplication;

  /** An organization whose catalog has the names the template uses. */
  async function organization() {
    const org = await adminOf(db, app);
    for (const name of ['Gerente general', 'Contador', 'Tesorero']) await org.admin.post('/positions', { name }).expect(201);
    await org.admin.post('/groups', { name: 'Mesa TI' }).expect(201);
    await org.admin.post('/approval-group-types', { name: 'Jefatura' }).expect(201);
    return org;
  }
  async function newDraft(admin: ApiClient) {
    const category = (await admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
    return `/workflows/${workflow.id}/versions/${workflow.versions[0].id}`;
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('writes the whole draft, ready to publish, without the assistant being on', async () => {
    const { admin } = await organization();
    const base = await newDraft(admin);
    expect((await admin.post(`${base}/import`, { revision: 0, spec: advanceSpec() }).expect(200)).body).toEqual({ revision: 1, errors: 0, warnings: 0 });
    const version = (await admin.get(base).expect(200)).body as VersionDetailResponse;
    expect(version.document.steps).toHaveLength(9);
    await admin.post(`${base}/publish`, {}).expect(200);
  });

  it('refuses a template that names what the organization does not have, a stale revision and a published version', async () => {
    const { admin } = await adminOf(db, app);
    const base = await newDraft(admin);
    const refused = (await admin.post(`${base}/import`, { revision: 0, spec: advanceSpec() }).expect(400)).body.error;
    expect(refused.code).toBe('VALIDATION_FAILED');
    expect(refused.details.problems.length).toBeGreaterThan(0);
    expect(((await admin.get(base).expect(200)).body as VersionDetailResponse).version.revision).toBe(0);

    const ready = await organization();
    const draft = await newDraft(ready.admin);
    expect((await ready.admin.post(`${draft}/import`, { revision: 3, spec: advanceSpec() }).expect(409)).body.error.code).toBe('STALE_REVISION');
    await ready.admin.post(`${draft}/import`, { revision: 0, spec: { ...advanceSpec(), steps: 'no' } }).expect(400);
    await ready.admin.post(`${draft}/import`, { revision: 0, spec: advanceSpec() }).expect(200);
    await ready.admin.post(`${draft}/publish`, {}).expect(200);
    expect((await ready.admin.post(`${draft}/import`, { revision: 1, spec: advanceSpec() })).status).toBe(409);
  });

  it('needs permission to edit workflows, and stays inside the organization', async () => {
    const a = await organization();
    const b = await organization();
    const base = await newDraft(a.admin);
    const reader = await clientWith(db, app, a.tenant, [{ action: 'read', subject: 'Workflow' }]);
    await reader.post(`${base}/import`, { revision: 0, spec: advanceSpec() }).expect(403);
    await b.admin.post(`${base}/import`, { revision: 0, spec: advanceSpec() }).expect(404);
    expect(((await a.admin.get(base).expect(200)).body as VersionDetailResponse).version.revision).toBe(0);
  });
});
