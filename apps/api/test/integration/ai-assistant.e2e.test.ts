import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { SeededTenant } from '@procesabpm/db/testing/fixtures';
import { AI_NOTICE_VERSION } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, type ApiClient, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ AI_ASSISTANT_AVAILABLE: 'true', AI_DAILY_JOBS_PER_TENANT: '3' });

const DESCRIPTION = 'El asesor pide un anticipo de viaje, lo aprueba su jefe y el tesorero lo paga.';
const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

describe('AI assistant API: the switch, the requests and the daily limit', () => {
  let db: TestDatabase;
  let app: INestApplication;

  const newDraft = async (client: ApiClient) => {
    const category = (await client.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await client.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await client.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
    return { workflowId: workflow.id as string, versionId: workflow.versions[0].id as string, base: `/workflows/${workflow.id}/versions/${workflow.versions[0].id}` };
  };
  const enable = (client: ApiClient) => client.put('/settings/ai-assistant', { enabled: true, acceptedNoticeVersion: AI_NOTICE_VERSION }).expect(200);
  const ask = (client: ApiClient, base: string, body: object = {}) => client.post(`${base}/ai-draft`, { description: DESCRIPTION, revision: 0, ...body });
  const auditRows = async (tenantId: string, action: string) => (await db.owner.query('SELECT entity_id, after FROM audit_logs WHERE tenant_id = $1 AND action = $2 ORDER BY created_at', [tenantId, action])).rows;
  const organization = async (): Promise<{ tenant: SeededTenant; admin: ApiClient }> => adminOf(db, app);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('the switch', () => {
    it('starts off, turns on only with the current notice, and audits the consent', async () => {
      const { tenant, admin } = await organization();
      expect((await admin.get('/settings/ai-assistant').expect(200)).body).toEqual({ available: true, enabled: false, noticeVersion: AI_NOTICE_VERSION, limits: { jobsPerDay: 3, tokensPerDay: 1_000_000 }, today: { jobs: 0, tokens: 0 } });
      await admin.put('/settings/ai-assistant', { enabled: true }).expect(400);
      await admin.put('/settings/ai-assistant', { enabled: true, acceptedNoticeVersion: AI_NOTICE_VERSION + 1 }).expect(400);
      expect((await enable(admin)).body.enabled).toBe(true);
      await admin.put('/settings/ai-assistant', { enabled: false }).expect(200);
      expect((await auditRows(tenant.tenantId, 'tenant.ai_assistant_updated')).map((row) => row.after)).toEqual([{ enabled: true, noticeVersion: AI_NOTICE_VERSION }, { enabled: false }]);
    });

    it('is for administrators of the settings only', async () => {
      const { tenant } = await organization();
      const designer = await clientWith(db, app, tenant, [{ action: 'update', subject: 'Workflow' }]);
      await designer.get('/settings/ai-assistant').expect(403);
      await designer.put('/settings/ai-assistant', { enabled: true, acceptedNoticeVersion: AI_NOTICE_VERSION }).expect(403);
    });
  });

  describe('requests', () => {
    it('are refused while the organization has the assistant off', async () => {
      const { admin } = await organization();
      const draft = await newDraft(admin);
      expect((await ask(admin, draft.base).expect(403)).body.error.code).toBe('AI_ASSISTANT_DISABLED');
      expect((await admin.get(`/ai-assistant/availability?versionId=${draft.versionId}`).expect(200)).body).toEqual({ available: false, remainingJobsToday: 0, activeJobId: null });
    });

    it('records a PENDING request for the draft, one at a time, audited without the description', async () => {
      const { tenant, admin } = await organization();
      await enable(admin);
      const draft = await newDraft(admin);
      const { jobId } = (await ask(admin, draft.base).expect(202)).body;
      expect((await admin.get(`/ai-jobs/${jobId}`).expect(200)).body).toMatchObject({ id: jobId, status: 'PENDING', errorCode: null, result: null });
      expect((await admin.get(`/ai-assistant/availability?versionId=${draft.versionId}`).expect(200)).body).toEqual({ available: true, remainingJobsToday: 2, activeJobId: jobId });
      expect((await ask(admin, draft.base).expect(409)).body.error.code).toBe('AI_JOB_IN_PROGRESS');
      const [audit] = await auditRows(tenant.tenantId, 'workflow.ai_draft_requested');
      expect(audit).toEqual({ entity_id: draft.workflowId, after: { versionId: draft.versionId, jobId, model: 'deepseek-v4-pro', inputChars: DESCRIPTION.length } });
      expect(JSON.stringify(audit)).not.toContain('anticipo');
    });

    it('needs the draft as the person sees it, and a real description', async () => {
      const { admin } = await organization();
      await enable(admin);
      const draft = await newDraft(admin);
      expect((await ask(admin, draft.base, { revision: 7 }).expect(409)).body.error).toMatchObject({ code: 'STALE_REVISION', details: { currentRevision: 0 } });
      await ask(admin, draft.base, { description: 'corto' }).expect(400);
      await admin.post(`${draft.base}/publish`, {}).expect(200);
      expect((await ask(admin, draft.base)).status).toBe(409);
      await ask(admin, `/workflows/${draft.workflowId}/versions/018f3c1e-7b2a-7c3d-9e4f-0123456789ab`).expect(404);
    });

    it('stops at the daily limit of the organization and says when it resets', async () => {
      const { admin } = await organization();
      await enable(admin);
      for (let index = 0; index < 3; index += 1) await ask(admin, (await newDraft(admin)).base).expect(202);
      const refused = await ask(admin, (await newDraft(admin)).base).expect(422);
      expect(refused.body.error.code).toBe('AI_DAILY_LIMIT_REACHED');
      expect(new Date(refused.body.error.details.resetsAt).getTime()).toBeGreaterThan(Date.now());
      expect((await admin.get('/settings/ai-assistant').expect(200)).body.today).toEqual({ jobs: 3, tokens: 0 });
      const usage = (await admin.get('/settings/ai-assistant/usage').expect(200)).body;
      expect(usage.recentJobs).toHaveLength(3);
      expect(usage.recentJobs[0]).toMatchObject({ status: 'PENDING', model: 'deepseek-v4-pro', tokens: 0 });
      expect(usage.recentJobs[0].requesterName.length).toBeGreaterThan(0);
    });

    it('show the history of the draft with descriptions, oldest first, and are cancelled by any designer, audited', async () => {
      const { tenant, admin } = await organization();
      await enable(admin);
      const draft = await newDraft(admin);
      const first = (await ask(admin, draft.base).expect(202)).body.jobId as string;
      const designer = await clientWith(db, app, tenant, [{ action: 'update', subject: 'Workflow' }]);
      const cancelled = (await designer.post(`/ai-jobs/${first}/cancel`, {}).expect(200)).body;
      expect(cancelled).toMatchObject({ id: first, status: 'FAILED', errorCode: 'CANCELLED', stage: null, round: null, problems: null, result: null });
      expect((await designer.post(`/ai-jobs/${first}/cancel`, {}).expect(422)).body.error.code).toBe('INVALID_STATE');
      const second = (await ask(admin, draft.base, { description: `${DESCRIPTION} Segunda versión.` }).expect(202)).body.jobId as string;

      const history = (await designer.get(`${draft.base}/ai-jobs`).expect(200)).body;
      expect(history.jobs.map((job: { id: string }) => job.id)).toEqual([first, second]);
      expect(history.jobs[0]).toMatchObject({ description: DESCRIPTION, status: 'FAILED', errorCode: 'CANCELLED', requestedById: expect.any(String), tokens: 0 });
      expect(history.jobs[0].cancelledByName.length).toBeGreaterThan(0);
      expect(history.jobs[0].requesterName.length).toBeGreaterThan(0);
      expect(history.jobs[1]).toMatchObject({ status: 'PENDING', description: `${DESCRIPTION} Segunda versión.`, cancelledByName: null });
      expect((await designer.get(`${draft.base}/ai-jobs?limit=1`).expect(200)).body.jobs.map((job: { id: string }) => job.id)).toEqual([second]);
      await designer.get(`${draft.base}/ai-jobs?limit=99`).expect(400);

      const [audit] = await auditRows(tenant.tenantId, 'workflow.ai_draft_cancelled');
      expect(audit).toEqual({ entity_id: draft.workflowId, after: { versionId: draft.versionId, jobId: first } });
      expect(JSON.stringify(await auditRows(tenant.tenantId, 'workflow.ai_draft_cancelled'))).not.toContain('anticipo');
    });

    it('need permission to edit workflows, and stay inside the organization', async () => {
      const a = await organization();
      const b = await organization();
      await enable(a.admin);
      const draft = await newDraft(a.admin);
      const { jobId } = (await ask(a.admin, draft.base).expect(202)).body;
      const reader = await clientWith(db, app, a.tenant, [{ action: 'read', subject: 'Workflow' }]);
      await ask(reader, draft.base).expect(403);
      await reader.get(`/ai-jobs/${jobId}`).expect(403);
      await reader.get(`${draft.base}/ai-jobs`).expect(403);
      await reader.post(`/ai-jobs/${jobId}/cancel`, {}).expect(403);
      await b.admin.get(`/ai-jobs/${jobId}`).expect(404);
      await b.admin.post(`/ai-jobs/${jobId}/cancel`, {}).expect(404);
      await b.admin.get(`${draft.base}/ai-jobs`).expect(404);
      expect((await a.admin.get(`/ai-jobs/${jobId}`).expect(200)).body.status).toBe('PENDING');
      await enable(b.admin);
      await ask(b.admin, draft.base).expect(404);
      expect((await b.admin.get('/settings/ai-assistant/usage').expect(200)).body.recentJobs).toEqual([]);
    });
  });
});
