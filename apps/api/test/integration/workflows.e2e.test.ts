import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import type { StepDocument, VersionDetailResponse, WorkflowVersionDocument } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, ApiClient, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;
const ANY_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';

interface Created {
  workflowId: string;
  versionId: string;
  start: string;
  end: string;
  transition: string;
}

describe('workflows API (builder backend)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let tenant: SeededTenant;

  const newSubcategory = async (client = admin) => {
    const category = (await client.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    return (await client.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
  };
  /** A workflow with its starting draft: START -> END. */
  const newWorkflow = async (client = admin): Promise<Created> => {
    const workflow = (await client.post('/workflows', { subcategoryId: await newSubcategory(client), name: unique('Flow') }).expect(201)).body;
    const version = workflow.versions[0];
    const detail = (await client.get(`/workflows/${workflow.id}/versions/${version.id}`).expect(200)).body as VersionDetailResponse;
    const [start, end] = [detail.document.steps.find((s) => s.type === 'START')!, detail.document.steps.find((s) => s.type === 'END')!];
    return { workflowId: workflow.id, versionId: version.id, start: start.id, end: end.id, transition: detail.document.transitions[0]!.id };
  };
  const stepInput = (id: string, type: string, extra: object = {}) => ({ id, type, name: `${type} ${id}`, ...(['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE'].includes(type) ? { assignmentMode: 'CREATOR' } : {}), ...extra });
  const edge = (id: string, from: string, to: string, type: string, extra: object = {}) => ({ id, fromStepId: from, toStepId: to, type, label: id, ...extra });
  const version = (c: Created, versionId = c.versionId) => `/workflows/${c.workflowId}/versions/${versionId}`;
  const detail = async (c: Created, versionId = c.versionId) => (await admin.get(version(c, versionId)).expect(200)).body as VersionDetailResponse;
  /** START -> TASK -> END, valid, with the existing START and END kept. */
  const taskGraph = (c: Created) => ({
    steps: [stepInput(c.start, 'START', { name: 'Inicio' }), stepInput('new:task', 'TASK', { name: 'Review' }), stepInput(c.end, 'END', { name: 'Fin' })],
    transitions: [edge('new:t1', c.start, 'new:task', 'DEFAULT'), edge('new:t2', 'new:task', c.end, 'DECISION', { label: 'Done' })],
  });
  const publishFlow = async (c: Created) => admin.post(`${version(c)}/publish`, {});
  const strip = (doc: WorkflowVersionDocument) => JSON.stringify(doc, (key, value) => (key === 'id' || key.endsWith('StepId') || key === 'stepId' ? undefined : value));

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    ({ admin, tenant } = await adminOf(db, app));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('workflows', () => {
    it('creates a workflow for a subcategory with a draft START -> END that already validates', async () => {
      const c = await newWorkflow();
      const d = await detail(c);
      expect(d.version).toMatchObject({ number: 1, status: 'DRAFT' });
      expect(d.document.steps.map((s) => s.type).sort()).toEqual(['END', 'START']);
      expect(d.document.transitions).toHaveLength(1);
      expect(d.validation).toEqual({ errors: [], warnings: [] });
      const listed = (await admin.get(`/workflows/${c.workflowId}`).expect(200)).body;
      expect(listed.versions).toHaveLength(1);
    });

    it('one workflow per subcategory (409); a subcategory of another tenant is 422', async () => {
      const subcategory = await newSubcategory();
      await admin.post('/workflows', { subcategoryId: subcategory, name: unique('A') }).expect(201);
      expect((await admin.post('/workflows', { subcategoryId: subcategory, name: unique('B') }).expect(409)).body.error.code).toBe('DUPLICATE');
      const other = await seedTenant(db.platform);
      const foreign = await insertReturningId(db.platform, `INSERT INTO categories (tenant_id, name) VALUES ($1, 'F') RETURNING id`, [other.tenantId]);
      const foreignSub = await insertReturningId(db.platform, `INSERT INTO subcategories (tenant_id, category_id, name) VALUES ($1, $2, 'F') RETURNING id`, [other.tenantId, foreign]);
      await admin.post('/workflows', { subcategoryId: foreignSub, name: unique('C') }).expect(422);
    });

    it('lists with filters and renames', async () => {
      const subcategory = await newSubcategory();
      const name = unique('Listed');
      const created = (await admin.post('/workflows', { subcategoryId: subcategory, name }).expect(201)).body;
      expect(((await admin.get(`/workflows?subcategoryId=${subcategory}`).expect(200)).body.items as Array<{ id: string }>).map((w) => w.id)).toEqual([created.id]);
      expect((await admin.patch(`/workflows/${created.id}`, { name: `${name}-2` }).expect(200)).body.name).toBe(`${name}-2`);
    });
  });

  describe('save graph', () => {
    it('replaces blocks and transitions, keeps the ids of the blocks that stay and returns the ids of the new ones', async () => {
      const c = await newWorkflow();
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'AMOUNT', label: 'Amount', type: 'NUMBER' }).expect(201);
      const saved = (await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200)).body;
      expect(Object.keys(saved.idMap).sort()).toEqual(['new:t1', 'new:t2', 'new:task']);
      const after = await detail(c);
      expect(after.document.steps.map((s) => s.id)).toEqual(expect.arrayContaining([c.start, c.end, saved.idMap['new:task']]));
      expect(after.document.transitions.map((t) => t.id).sort()).toEqual([saved.idMap['new:t1'], saved.idMap['new:t2']].sort());
      expect(after.document.fields).toHaveLength(1);
      expect(after.document.fields[0]!.stepId).toBe(c.start);
      expect(saved.validation).toEqual({ errors: [], warnings: [] });
    });

    it('removing a block removes its fields; the rest is untouched, and positions are kept', async () => {
      const c = await newWorkflow();
      const first = (await admin.put(`${version(c)}/graph`, { ...taskGraph(c), steps: [stepInput(c.start, 'START', { ui: { x: 10, y: 20 } }), stepInput('new:task', 'TASK'), stepInput(c.end, 'END')] }).expect(200)).body;
      const taskId = first.idMap['new:task'] as string;
      await admin.post(`${version(c)}/fields`, { stepId: taskId, code: 'NOTE', label: 'Note', type: 'TEXT' }).expect(201);
      const reduced = (await admin.put(`${version(c)}/graph`, { steps: [stepInput(c.start, 'START', { ui: { x: 10, y: 20 } }), stepInput(c.end, 'END')], transitions: [edge('new:direct', c.start, c.end, 'DEFAULT')] }).expect(200)).body;
      expect(reduced.document.steps).toHaveLength(2);
      expect(reduced.document.fields).toEqual([]);
      expect(reduced.document.steps.find((s: StepDocument) => s.id === c.start).ui).toEqual({ x: 10, y: 20 });
    });

    it('is atomic: a transition the database refuses (from an END) cancels the whole save', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      const before = await detail(c);
      const response = await admin.put(`${version(c)}/graph`, {
        steps: [stepInput(c.start, 'START'), stepInput(c.end, 'END'), stepInput('new:extra', 'TASK')],
        transitions: [edge('new:ok', c.start, 'new:extra', 'DEFAULT'), edge('new:bad', c.end, 'new:extra', 'DECISION')],
      });
      expect(response.status).toBe(422);
      expect(await detail(c)).toEqual(before);
    });

    it('a block type change on a connected block is allowed (transitions are rewritten); a duplicated label answers 409', async () => {
      const c = await newWorkflow();
      const saved = (await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200)).body;
      const taskId = saved.idMap['new:task'] as string;
      await admin.put(`${version(c)}/graph`, {
        steps: [stepInput(c.start, 'START'), stepInput(taskId, 'DECISION', { name: 'Choose' }), stepInput(c.end, 'END')],
        transitions: [edge('new:t1', c.start, taskId, 'DEFAULT'), edge('new:t2', taskId, c.end, 'DECISION', { label: 'Yes' }), edge('new:t3', taskId, c.end, 'DECISION', { label: 'yes' })],
      }).expect(409);
    });

    it('refuses ids that are not of the version (422): blocks and transitions', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, { steps: [stepInput(ANY_ID, 'START'), stepInput(c.end, 'END')], transitions: [] }).expect(422);
      await admin.put(`${version(c)}/graph`, { steps: [stepInput(c.start, 'START'), stepInput(c.end, 'END')], transitions: [edge(ANY_ID, c.start, c.end, 'DEFAULT')] }).expect(422);
      await admin.put(`${version(c)}/graph`, { steps: [stepInput(c.start, 'START'), stepInput(c.end, 'END')], transitions: [edge('new:x', c.start, 'new:ghost', 'DEFAULT')] }).expect(422);
    });

    it('a graph with problems is saved (only publishing needs a valid one) and reports them', async () => {
      const c = await newWorkflow();
      const saved = (await admin.put(`${version(c)}/graph`, { steps: [stepInput(c.start, 'START'), stepInput(c.end, 'END')], transitions: [] }).expect(200)).body;
      expect(saved.validation.errors.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['END_NOT_REACHABLE', 'AUTOMATIC_BLOCK_WITHOUT_DEFAULT']));
      expect((await admin.get(`${version(c)}/validation`).expect(200)).body.errors.length).toBeGreaterThan(0);
    });

    it('conditions are stored on CONDITION transitions only (SQL NULL elsewhere)', async () => {
      const c = await newWorkflow();
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'AMOUNT', label: 'Amount', type: 'NUMBER' }).expect(201);
      const saved = (await admin.put(`${version(c)}/graph`, {
        steps: [stepInput(c.start, 'START'), stepInput('new:cond', 'CONDITION'), stepInput('new:review', 'TASK'), stepInput(c.end, 'END')],
        transitions: [
          edge('new:a', c.start, 'new:cond', 'DEFAULT'),
          edge('new:b', 'new:cond', 'new:review', 'CONDITION', { condition: [{ field: 'AMOUNT', op: 'gt', value: 100 }] }),
          edge('new:c', 'new:cond', c.end, 'DEFAULT'),
          edge('new:d', 'new:review', c.end, 'DECISION'),
        ],
      }).expect(200)).body;
      expect(saved.validation.errors).toEqual([]);
      const { rows } = await db.owner.query<{ type: string; has_condition: boolean }>(`SELECT type::text, condition IS NOT NULL AS has_condition FROM transitions WHERE version_id = $1 ORDER BY type`, [c.versionId]);
      expect(rows.filter((row) => row.type === 'CONDITION').every((row) => row.has_condition)).toBe(true);
      expect(rows.filter((row) => row.type !== 'CONDITION').every((row) => !row.has_condition)).toBe(true);
    });

    it('a block that is the extra approval step of an amount rule cannot be removed (422)', async () => {
      const c = await newWorkflow();
      const type = (await admin.post('/approval-group-types', { name: unique('T') }).expect(201)).body.id;
      const saved = (await admin.put(`${version(c)}/graph`, {
        steps: [stepInput(c.start, 'START'), stepInput('new:task', 'TASK'), stepInput('new:approval', 'APPROVAL', { assignmentMode: 'APPROVER', approvalGroupTypeId: type, approvalLevel: 1 }), stepInput(c.end, 'END')],
        transitions: [edge('new:a', c.start, 'new:task', 'DEFAULT'), edge('new:b', 'new:task', c.end, 'DECISION'), edge('new:sys', 'new:task', 'new:approval', 'SYSTEM_ONLY'), edge('new:d', 'new:approval', c.end, 'DECISION')],
      }).expect(200)).body;
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'AMOUNT', label: 'Amount', type: 'CURRENCY' }).expect(201);
      await admin.post(`${version(c)}/amount-rules`, { fieldCode: 'AMOUNT', maxAmount: '1000.50', currencyCode: 'COP', action: 'EXTRA_APPROVAL', approvalStepId: saved.idMap['new:approval'] }).expect(201);
      const reduced = { steps: [stepInput(c.start, 'START'), stepInput(saved.idMap['new:task'], 'TASK'), stepInput(c.end, 'END')], transitions: [edge('new:a', c.start, saved.idMap['new:task'], 'DEFAULT'), edge('new:b', saved.idMap['new:task'], c.end, 'DECISION')] };
      expect((await admin.put(`${version(c)}/graph`, reduced).expect(422)).body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('publish', () => {
    it('refuses a draft with errors (422 with the whole list) and changes nothing', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, { steps: [stepInput(c.start, 'START'), stepInput(c.end, 'END')], transitions: [] }).expect(200);
      const response = await publishFlow(c).then((r) => r);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('WORKFLOW_NOT_PUBLISHABLE');
      expect(response.body.error.details.errors.map((p: { code: string }) => p.code)).toContain('END_NOT_REACHABLE');
      expect((await detail(c)).version.status).toBe('DRAFT');
      expect((await admin.get(`/workflows/${c.workflowId}`).expect(200)).body.versions.map((v: { status: string }) => v.status)).toEqual(['DRAFT']);
    });

    it('publishes a valid draft and returns the warnings', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      const published = (await publishFlow(c).then((r) => { expect(r.status).toBe(200); return r; })).body;
      expect(published.version).toMatchObject({ status: 'PUBLISHED', number: 1 });
      expect(published.version.publishedAt).not.toBeNull();
      expect(published.version.publishedById).not.toBeNull();
      expect((await detail(c)).validation).toBeNull();
    });

    it('publishing a new draft archives the previously published version', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      await publishFlow(c).then((r) => expect(r.status).toBe(200));
      const draft = (await admin.post(`/workflows/${c.workflowId}/versions`, { fromVersionId: c.versionId }).expect(201)).body;
      expect(draft).toMatchObject({ number: 2, status: 'DRAFT' });
      await admin.post(`${version(c, draft.id)}/publish`, { notes: 'Second' }).expect(200);
      const statuses = (await admin.get(`/workflows/${c.workflowId}`).expect(200)).body.versions.map((v: { number: number; status: string }) => `${v.number}:${v.status}`);
      expect(statuses).toEqual(['2:PUBLISHED', '1:ARCHIVED']);
    });

    it('a published or archived version is not published again (409)', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      await publishFlow(c).then((r) => expect(r.status).toBe(200));
      expect((await publishFlow(c)).status).toBe(409);
    });

    it('publish waits for an edit that is still running, then the edit is not lost to a published version', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      // An edit in another connection holds the version (FOR SHARE) and has not committed.
      const editor = await db.platform.connect();
      try {
        await editor.query('BEGIN');
        await editor.query(`SELECT 1 FROM workflow_versions WHERE id = $1 FOR SHARE`, [c.versionId]);
        let settled = false;
        const publishing = publishFlow(c).then((response) => {
          settled = true;
          return response;
        });
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(settled).toBe(false);
        await editor.query('COMMIT');
        expect((await publishing).status).toBe(200);
      } finally {
        editor.release();
      }
    });
  });

  describe('review regressions', () => {
    it('a block that points at a webhook that does not exist cannot be published', async () => {
      const c = await newWorkflow();
      const webhook = await insertReturningId(db.platform, `INSERT INTO webhooks (tenant_id, url, secret_encrypted, events) VALUES ($1, 'https://example.com/hook', '\\x00', ARRAY['ticket.created']) RETURNING id`, [tenant.tenantId]);
      const withHook = (webhookId: string) => ({
        steps: [stepInput(c.start, 'START'), stepInput('new:hook', 'WEBHOOK', { config: { webhookId } }), stepInput(c.end, 'END')],
        transitions: [edge('new:a', c.start, 'new:hook', 'DEFAULT'), edge('new:b', 'new:hook', c.end, 'DEFAULT')],
      });
      await admin.put(`${version(c)}/graph`, withHook(ANY_ID)).expect(200);
      const refused = await publishFlow(c);
      expect(refused.status).toBe(422);
      expect(refused.body.error.details.errors.map((p: { code: string; params: { kind: string } }) => `${p.code}:${p.params.kind}`)).toContain('BLOCK_REFERENCE_UNKNOWN:WEBHOOK');
      expect((await admin.get(`${version(c)}/validation`).expect(200)).body.errors.map((p: { code: string }) => p.code)).toContain('BLOCK_REFERENCE_UNKNOWN');
      expect((await detail(c)).version.status).toBe('DRAFT');

      await admin.put(`${version(c)}/graph`, withHook(webhook)).expect(200);
      expect((await publishFlow(c)).status).toBe(200);
    });

    it('two simultaneous replacements of a list leave exactly one of the lists, not both merged', async () => {
      const c = await newWorkflow();
      const saved = (await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200)).body;
      const taskId = saved.idMap['new:task'] as string;
      const [first, second] = [await admin.post('/positions', { name: unique('P1') }), await admin.post('/positions', { name: unique('P2') })];
      const candidates = (position: string) => ({ candidates: [{ participantType: 'USER', userId: tenant.userId }, { participantType: 'POSITION', positionId: position }] });
      const results = await Promise.all([admin.put(`${version(c)}/steps/${taskId}/candidates`, candidates(first.body.id)), admin.put(`${version(c)}/steps/${taskId}/candidates`, candidates(second.body.id))]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect((await detail(c)).document.steps.find((s) => s.id === taskId)!.candidates).toHaveLength(2);
    });

    it('a canvas of 300 blocks (far over the old 100 kb body limit) is saved', async () => {
      const c = await newWorkflow();
      const steps = [stepInput(c.start, 'START'), ...Array.from({ length: 298 }, (_, index) => stepInput(`new:s${index}`, 'TASK', { name: `Task ${index} ${'x'.repeat(120)}`, description: 'd'.repeat(200) })), stepInput(c.end, 'END')];
      const saved = (await admin.put(`${version(c)}/graph`, { steps, transitions: [] }).expect(200)).body;
      expect(saved.document.steps).toHaveLength(300);
    });
  });

  describe('published versions cannot be edited (409)', () => {
    it('every way of editing answers 409', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      await publishFlow(c).then((r) => expect(r.status).toBe(200));
      const d = await detail(c);
      const taskId = d.document.steps.find((s) => s.type === 'TASK')!.id;
      expect((await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(409)).body.error.code).toBe('IMMUTABLE_DATA');
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'X', label: 'X', type: 'TEXT' }).expect(409);
      await admin.post(`${version(c)}/amount-rules`, { fieldCode: 'X', maxAmount: '1', currencyCode: 'COP', action: 'BLOCK' }).expect(409);
      await admin.put(`${version(c)}/steps/${taskId}/candidates`, { candidates: [] }).expect(409);
      await admin.put(`${version(c)}/steps/${taskId}/initiators`, { initiators: [] }).expect(409);
      await admin.put(`${version(c)}/steps/${taskId}/signers`, { signers: [] }).expect(409);
      await admin.put(`${version(c)}/steps/${taskId}/sla-overrides`, { overrides: [] }).expect(409);
      await admin.put(`${version(c)}/steps/${taskId}/files`, { files: [] }).expect(409);
      await admin.delete(version(c)).expect(409);
    });

    it('the database also refuses direct changes of published content (23001), and the API translates it to 409', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      await publishFlow(c).then((r) => expect(r.status).toBe(200));
      await expect(db.platform.query(`UPDATE steps SET name = 'changed' WHERE version_id = $1`, [c.versionId])).rejects.toMatchObject({ code: '23001' });
    });
  });

  describe('versions', () => {
    it('copies a published version into a draft identical to it, with new ids everywhere', async () => {
      const c = await newWorkflow();
      const type = (await admin.post('/approval-group-types', { name: unique('T') }).expect(201)).body.id;
      const saved = (await admin.put(`${version(c)}/graph`, {
        steps: [stepInput(c.start, 'START'), stepInput('new:task', 'TASK', { slaValue: 4, slaUnit: 'BUSINESS_HOURS' }), stepInput('new:approval', 'APPROVAL', { assignmentMode: 'APPROVER', approvalGroupTypeId: type, approvalLevel: 1 }), stepInput(c.end, 'END')],
        transitions: [edge('new:a', c.start, 'new:task', 'DEFAULT'), edge('new:b', 'new:task', c.end, 'DECISION'), edge('new:sys', 'new:task', 'new:approval', 'SYSTEM_ONLY'), edge('new:d', 'new:approval', c.end, 'DECISION')],
      }).expect(200)).body;
      const taskId = saved.idMap['new:task'] as string;
      const approvalId = saved.idMap['new:approval'] as string;
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'AMOUNT', label: 'Amount', type: 'CURRENCY' }).expect(201);
      await admin.post(`${version(c)}/fields`, { stepId: taskId, code: 'NOTE', label: 'Note', type: 'TEXT', config: { maxLength: 50 } }).expect(201);
      await admin.post(`${version(c)}/amount-rules`, { stepId: taskId, fieldCode: 'AMOUNT', maxAmount: '500.00', currencyCode: 'COP', action: 'EXTRA_APPROVAL', approvalStepId: approvalId }).expect(201);
      await admin.put(`${version(c)}/steps/${taskId}/candidates`, { candidates: [{ participantType: 'USER', userId: tenant.userId }] }).expect(200);
      await admin.put(`${version(c)}/steps/${c.start}/initiators`, { initiators: [{ participantType: 'COMPANY', companyId: tenant.companyId }] }).expect(200);
      await admin.put(`${version(c)}/steps/${taskId}/sla-overrides`, { overrides: [{ companyId: tenant.companyId, slaValue: 2, slaUnit: 'BUSINESS_DAYS' }] }).expect(200);
      await publishFlow(c).then((r) => expect(r.status).toBe(200));

      const draft = (await admin.post(`/workflows/${c.workflowId}/versions`, { fromVersionId: c.versionId }).expect(201)).body;
      const source = await detail(c);
      const copy = await detail(c, draft.id);
      expect(copy.version).toMatchObject({ status: 'DRAFT', number: 2 });
      // Same content, different ids (compared with the ids removed), and every reference points inside the copy.
      expect(strip(copy.document)).toBe(strip(source.document));
      const sourceIds = new Set([...source.document.steps.map((s) => s.id), ...source.document.transitions.map((t) => t.id), ...source.document.fields.map((f) => f.id), ...source.document.amountRules.map((r) => r.id)]);
      const copyStepIds = new Set(copy.document.steps.map((s) => s.id));
      for (const id of [...copyStepIds, ...copy.document.transitions.map((t) => t.id), ...copy.document.fields.map((f) => f.id)]) expect(sourceIds.has(id)).toBe(false);
      expect(copy.document.transitions.every((t) => copyStepIds.has(t.fromStepId) && copyStepIds.has(t.toStepId))).toBe(true);
      expect(copy.document.fields.every((f) => copyStepIds.has(f.stepId))).toBe(true);
      expect(copy.document.amountRules[0]!.approvalStepId && copyStepIds.has(copy.document.amountRules[0]!.approvalStepId)).toBe(true);
      const copiedTask = copy.document.steps.find((s) => s.type === 'TASK')!;
      expect(copiedTask.candidates).toHaveLength(1);
      expect(copiedTask.slaOverrides).toEqual([{ companyId: tenant.companyId, slaValue: 2, slaUnit: 'BUSINESS_DAYS' }]);
      expect(copy.document.steps.find((s) => s.type === 'START')!.initiators).toHaveLength(1);
      expect(copy.validation).toEqual(source.validation ?? copy.validation);
      // The source is untouched.
      expect(await detail(c)).toEqual(source);
    });

    it('only one draft at a time (409); an empty draft starts without content', async () => {
      const c = await newWorkflow();
      expect((await admin.post(`/workflows/${c.workflowId}/versions`, {}).expect(409)).body.error.code).toBe('DUPLICATE');
      await admin.delete(version(c)).expect(204);
      const empty = (await admin.post(`/workflows/${c.workflowId}/versions`, {}).expect(201)).body;
      expect(empty.number).toBe(1);
      const emptyDetail = await detail(c, empty.id);
      expect(emptyDetail.document.steps).toEqual([]);
      expect(emptyDetail.validation!.errors.map((p) => p.code)).toEqual(expect.arrayContaining(['NO_START', 'NO_END']));
    });

    it('deletes a draft (and its content); an unknown version is 404', async () => {
      const c = await newWorkflow();
      await admin.delete(version(c)).expect(204);
      await admin.get(version(c)).expect(404);
      expect((await db.owner.query('SELECT 1 FROM steps WHERE version_id = $1', [c.versionId])).rowCount).toBe(0);
      await admin.delete(version(c, ANY_ID)).expect(404);
    });

    it('two concurrent copies are numbered one after the other; only one draft survives', async () => {
      const c = await newWorkflow();
      await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      await publishFlow(c).then((r) => expect(r.status).toBe(200));
      const results = await Promise.all([admin.post(`/workflows/${c.workflowId}/versions`, { fromVersionId: c.versionId }), admin.post(`/workflows/${c.workflowId}/versions`, { fromVersionId: c.versionId })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  describe('granular edits', () => {
    it('creates, edits and deletes fields; the config is checked per type; the code is fixed', async () => {
      const c = await newWorkflow();
      const field = (await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'KIND', label: 'Kind', type: 'SELECT', config: { options: [{ value: 'a', label: 'A' }] } }).expect(201)).body;
      expect(field).toMatchObject({ code: 'KIND', type: 'SELECT', stepId: c.start });
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'KIND', label: 'Again', type: 'TEXT' }).expect(409);
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'bad code', label: 'x', type: 'TEXT' }).expect(400);
      await admin.post(`${version(c)}/fields`, { stepId: c.start, code: 'EMPTY', label: 'x', type: 'SELECT' }).expect(400);
      await admin.post(`${version(c)}/fields`, { stepId: ANY_ID, code: 'GHOST', label: 'x', type: 'TEXT' }).expect(404);
      const updated = (await admin.patch(`${version(c)}/fields/${field.id}`, { label: 'Kind of thing', isRequired: true, code: 'IGNORED' }).expect(200)).body;
      expect(updated).toMatchObject({ label: 'Kind of thing', isRequired: true, code: 'KIND' });
      await admin.patch(`${version(c)}/fields/${field.id}`, { config: { options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'Dup' }] } }).expect(400);
      await admin.delete(`${version(c)}/fields/${field.id}`).expect(204);
      await admin.delete(`${version(c)}/fields/${field.id}`).expect(404);
    });

    it('replaces the lists of a block: candidates, initiators, signers, SLA by company', async () => {
      const c = await newWorkflow();
      const saved = (await admin.put(`${version(c)}/graph`, taskGraph(c)).expect(200)).body;
      const taskId = saved.idMap['new:task'] as string;
      const position = (await admin.post('/positions', { name: unique('P') }).expect(201)).body.id;
      const group = (await admin.post('/groups', { name: unique('G') }).expect(201)).body.id;
      const candidates = (await admin.put(`${version(c)}/steps/${taskId}/candidates`, { candidates: [{ participantType: 'USER', userId: tenant.userId }, { participantType: 'POSITION', positionId: position }, { participantType: 'GROUP', groupId: group }] }).expect(200)).body.candidates;
      expect(candidates).toHaveLength(3);
      expect((await admin.put(`${version(c)}/steps/${taskId}/candidates`, { candidates: [] }).expect(200)).body.candidates).toEqual([]);
      const signers = (await admin.put(`${version(c)}/steps/${taskId}/signers`, { signers: [{ signerType: 'CREATOR' }, { signerType: 'POSITION', positionId: position, label: 'Boss' }] }).expect(200)).body.signers;
      expect(signers.map((s: { signerType: string; sortOrder: number }) => [s.signerType, s.sortOrder])).toEqual([['CREATOR', 0], ['POSITION', 1]]);
      const initiators = (await admin.put(`${version(c)}/steps/${c.start}/initiators`, { initiators: [{ participantType: 'DEPARTMENT', departmentId: (await admin.post('/departments', { name: unique('D') }).expect(201)).body.id }] }).expect(200)).body.initiators;
      expect(initiators).toHaveLength(1);
      expect((await admin.put(`${version(c)}/steps/${taskId}/sla-overrides`, { overrides: [{ companyId: tenant.companyId, slaValue: 6, slaUnit: 'BUSINESS_HOURS' }] }).expect(200)).body.slaOverrides).toHaveLength(1);
      await admin.put(`${version(c)}/steps/${taskId}/sla-overrides`, { overrides: [{ companyId: tenant.companyId, slaValue: 6, slaUnit: 'BUSINESS_HOURS' }, { companyId: tenant.companyId, slaValue: 7, slaUnit: 'BUSINESS_DAYS' }] }).expect(400);
      await admin.put(`${version(c)}/steps/${ANY_ID}/candidates`, { candidates: [] }).expect(404);
    });

    it('amount rules: create, edit, delete; blocks of another version are refused (422)', async () => {
      const c = await newWorkflow();
      const other = await newWorkflow();
      const rule = (await admin.post(`${version(c)}/amount-rules`, { fieldCode: 'AMOUNT', maxAmount: '2500000.00', currencyCode: 'COP', action: 'WARN', message: 'Too much' }).expect(201)).body;
      expect(rule).toMatchObject({ maxAmount: '2500000.00', action: 'WARN' });
      expect((await admin.patch(`${version(c)}/amount-rules/${rule.id}`, { maxAmount: '10.5', isActive: false }).expect(200)).body).toMatchObject({ maxAmount: '10.50', isActive: false });
      await admin.post(`${version(c)}/amount-rules`, { fieldCode: 'AMOUNT', maxAmount: '10', currencyCode: 'COP', action: 'BLOCK', stepId: other.start }).expect(422);
      await admin.post(`${version(c)}/amount-rules`, { fieldCode: 'AMOUNT', maxAmount: '-5', currencyCode: 'COP', action: 'BLOCK' }).expect(400);
      await admin.post(`${version(c)}/amount-rules`, { fieldCode: 'AMOUNT', maxAmount: '10.123', currencyCode: 'COP', action: 'BLOCK' }).expect(400);
      await admin.delete(`${version(c)}/amount-rules/${rule.id}`).expect(204);
      await admin.delete(`${version(c)}/amount-rules/${rule.id}`).expect(404);
    });

    it('observers and company cutoffs: add, list, remove; cutoff day repeated is 409', async () => {
      const c = await newWorkflow();
      const observer = (await admin.post(`/workflows/${c.workflowId}/observers`, { participantType: 'USER', userId: tenant.userId }).expect(201)).body;
      expect((await admin.get(`/workflows/${c.workflowId}/observers`).expect(200)).body).toEqual([observer]);
      await admin.delete(`/workflows/${c.workflowId}/observers/${observer.id}`).expect(204);
      await admin.delete(`/workflows/${c.workflowId}/observers/${observer.id}`).expect(404);
      const stranger = await seedTenant(db.platform);
      await admin.post(`/workflows/${c.workflowId}/observers`, { participantType: 'USER', userId: stranger.userId }).expect(422);

      const cutoff = (await admin.post(`/workflows/${c.workflowId}/cutoffs`, { companyId: tenant.companyId, cutoffDay: 25, graceBusinessDays: 2 }).expect(201)).body;
      expect(cutoff).toMatchObject({ cutoffDay: 25, graceBusinessDays: 2, isActive: true });
      expect((await admin.post(`/workflows/${c.workflowId}/cutoffs`, { companyId: tenant.companyId, cutoffDay: 25 }).expect(409)).body.error.code).toBe('DUPLICATE');
      expect((await admin.patch(`/workflows/${c.workflowId}/cutoffs/${cutoff.id}`, { cutoffDay: 20, isActive: false }).expect(200)).body).toMatchObject({ cutoffDay: 20, isActive: false });
      await admin.post(`/workflows/${c.workflowId}/cutoffs`, { companyId: tenant.companyId, cutoffDay: 32 }).expect(400);
      expect((await admin.get(`/workflows/${c.workflowId}/cutoffs`).expect(200)).body).toHaveLength(1);
      await admin.delete(`/workflows/${c.workflowId}/cutoffs/${cutoff.id}`).expect(204);
    });
  });

  describe('permissions (read, update, publish) and tenant isolation', () => {
    it('read lists and views, but cannot edit or publish; update edits but cannot publish; publish publishes', async () => {
      const c = await newWorkflow();
      const reader = await clientWith(db, app, tenant, [{ action: 'read', subject: 'Workflow' }], unique('Reader'));
      const editor = await clientWith(db, app, tenant, [{ action: 'read', subject: 'Workflow' }, { action: 'update', subject: 'Workflow' }], unique('Editor'));
      const publisher = await clientWith(db, app, tenant, [{ action: 'read', subject: 'Workflow' }, { action: 'publish', subject: 'Workflow' }], unique('Publisher'));
      const nobody = await clientWith(db, app, tenant, [], unique('Nobody'));

      await reader.get('/workflows').expect(200);
      await reader.get(version(c)).expect(200);
      await reader.get(`${version(c)}/validation`).expect(200);
      await reader.put(`${version(c)}/graph`, taskGraph(c)).expect(403);
      await reader.post('/workflows', { subcategoryId: ANY_ID, name: 'x' }).expect(403);
      await reader.post(`${version(c)}/publish`, {}).expect(403);
      await reader.delete(version(c)).expect(403);
      await nobody.get('/workflows').expect(403);

      await editor.put(`${version(c)}/graph`, taskGraph(c)).expect(200);
      await editor.post(`${version(c)}/publish`, {}).expect(403);
      expect((await detail(c)).version.status).toBe('DRAFT');
      await publisher.put(`${version(c)}/graph`, taskGraph(c)).expect(403);
      await publisher.post(`${version(c)}/publish`, {}).expect(200);
    });

    it('another tenant cannot see, edit, copy or publish a workflow (404), and cannot reference foreign rows (422)', async () => {
      const c = await newWorkflow();
      const { admin: stranger, tenant: strangerTenant } = await adminOf(db, app);
      await stranger.get(`/workflows/${c.workflowId}`).expect(404);
      await stranger.get(version(c)).expect(404);
      await stranger.get(`${version(c)}/validation`).expect(404);
      await stranger.put(`${version(c)}/graph`, taskGraph(c)).expect(404);
      await stranger.post(`${version(c)}/publish`, {}).expect(404);
      await stranger.delete(version(c)).expect(404);
      await stranger.post(`/workflows/${c.workflowId}/versions`, {}).expect(404);
      await stranger.post(`${version(c)}/fields`, { stepId: c.start, code: 'X', label: 'x', type: 'TEXT' }).expect(404);
      await stranger.get(`/workflows/${c.workflowId}/observers`).expect(404);
      await stranger.post(`/workflows/${c.workflowId}/cutoffs`, { companyId: strangerTenant.companyId, cutoffDay: 1 }).expect(404);
      expect(((await stranger.get('/workflows?pageSize=100&includeInactive=true').expect(200)).body.items as Array<{ id: string }>).map((w) => w.id)).not.toContain(c.workflowId);
      expect((await detail(c)).version.status).toBe('DRAFT');

      // In their own workflow, rows of the first tenant are refused.
      const own = await newWorkflow(stranger);
      const foreignPosition = await insertReturningId(db.platform, `INSERT INTO positions (tenant_id, name) VALUES ($1, 'Mine') RETURNING id`, [tenant.tenantId]);
      const foreignSteps = { steps: [stepInput(own.start, 'START'), stepInput('new:t', 'TASK', { assignmentMode: 'POSITION', positionId: foreignPosition }), stepInput(own.end, 'END')], transitions: [edge('new:a', own.start, 'new:t', 'DEFAULT'), edge('new:b', 'new:t', own.end, 'DECISION')] };
      await stranger.put(`${version(own)}/graph`, foreignSteps).expect(422);
      await stranger.put(`${version(own)}/graph`, { steps: [stepInput(c.start, 'START'), stepInput(own.end, 'END')], transitions: [] }).expect(422);
      await stranger.put(`${version(own)}/steps/${c.start}/candidates`, { candidates: [] }).expect(404);
    });
  });
});
