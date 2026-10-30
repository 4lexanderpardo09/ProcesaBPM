import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { AI_NOTICE_VERSION } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { LlmProvider, type LlmRequest, type LlmResult } from '../../src/infrastructure/llm/llm-provider.js';
import { FormatDraftJob } from '../../src/modules/ai-assistant/application/format-draft.job.js';
import type { AiJobClaim } from '../../src/modules/ai-assistant/data/ai-job-claims.repository.js';
import { WorkerModule } from '../../src/worker.module.js';
import { adminOf, type ApiClient, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ AI_ASSISTANT_AVAILABLE: 'true' });

const USAGE = { promptTokens: 4000, cachedPromptTokens: 3000, completionTokens: 2500, reasoningTokens: 0 };
const DESCRIPTION = 'Un comprobante con el título del ticket, su número y una firma en blanco del cliente.';
const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;
const canvas = (elements: unknown[]) => ({ version: 2, page: { size: 'LETTER', orientation: 'PORTRAIT', marginBottom: 15 }, sheets: [{ name: '', condition: '' }], calculations: [], elements });
const text = (content: string) => ({ type: 'text', x: 15, y: 15, width: 120, height: 8, content, grow: false, style: { size: 16, bold: true } });
const signature = { type: 'signature', x: 15, y: 240, width: 60, height: 25, source: 'BLANK', stepName: null, signers: 'LAST', position: 1, label: 'Firma del cliente', showName: false, showDate: true, showLine: true };
/** What the model answers: a lean format (the defaults are filled in by the worker). */
const answer = (content: string) => ({ design: { page: { size: 'LETTER', orientation: 'PORTRAIT', marginBottom: 15 }, elements: [text(content), signature] }, assumptions: ['Supuse tamaño carta.'], decisions: [{ topic: 'SIGNATURES', text: 'Una firma en blanco del cliente abajo, como pide la descripción.' }] });

/** Answers from a script, like the provider would; it never leaves the test. */
class ScriptedProvider extends LlmProvider {
  readonly name = 'anthropic';
  readonly model = 'claude-haiku-5-5';
  script: unknown[] = [];
  readonly requests: LlmRequest[] = [];

  complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) return Promise.reject(new Error('no scripted answer left'));
    return Promise.resolve({ answer: { kind: 'tool_call', arguments: next }, usage: USAGE, durationMs: 1_500 });
  }
}

describe('Jiro in the PDF format designer', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let worker: TestingModule;
  const provider = new ScriptedProvider();

  /** An organization with the assistant on, a workflow and a canvas format with a title. */
  async function organization() {
    const { tenant, admin } = await adminOf(db, app);
    await admin.put('/settings/ai-assistant', { enabled: true, acceptedNoticeVersion: AI_NOTICE_VERSION }).expect(200);
    const category = (await admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body as { id: string };
    const saved = canvas([{ ...text('{{ticket.title}}'), id: 'title', name: 'Título', repeat: false, locked: false, sheet: 0, condition: '', style: { font: 'HELVETICA', size: 16, bold: true, italic: false, underline: false, color: '#111827', align: 'LEFT', verticalAlign: 'TOP', background: null, border: 0, borderColor: '#111827', radius: 0, padding: 1, lineHeight: 1 } }]);
    const format = (await admin.post(`/workflows/${workflow.id}/pdf-formats`, { name: unique('Formato'), design: saved }).expect(201)).body as { id: string };
    return { tenant, admin, saved, base: `/workflows/${workflow.id}/pdf-formats/${format.id}`, workflowId: workflow.id, formatId: format.id };
  }
  /** Claims exactly this request (other files' requests are left alone), as claim_due_ai_jobs would. */
  async function claim(tenantId: string, jobId: string): Promise<AiJobClaim> {
    const { rows } = await db.owner.query<{ claim_token: string }>(
      `UPDATE ai_jobs SET status = 'RUNNING', attempts = 1, claim_token = gen_random_uuid(), lease_until = now() + interval '10 minutes', started_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING claim_token::text`,
      [tenantId, jobId],
    );
    return { tenantId, jobId, claimToken: rows[0]!.claim_token, attempt: 1 };
  }
  const run = async (tenantId: string, jobId: string, script: unknown[]) => {
    provider.script = [...script];
    provider.requests.length = 0;
    return worker.get(FormatDraftJob).run(await claim(tenantId, jobId));
  };
  const history = async (admin: ApiClient, base: string) => (await admin.get(`${base}/ai-jobs`).expect(200)).body.jobs as Array<Record<string, unknown>>;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).overrideProvider(LlmProvider).useValue(provider).compile();
    await worker.init();
  });
  afterAll(async () => {
    await worker.close();
    await app.close();
    await db.close();
  });

  it('records a request, designs the format round by round and hands the design back without touching the saved format', async () => {
    const org = await organization();
    expect((await org.admin.get(`${org.base}/ai-assistant`).expect(200)).body).toMatchObject({ available: true, activeJobId: null });
    const jobId = (await org.admin.post(`${org.base}/ai-draft`, { mode: 'CREATE', description: DESCRIPTION }).expect(202)).body.jobId as string;
    expect((await org.admin.get(`${org.base}/ai-assistant`).expect(200)).body.activeJobId).toBe(jobId);
    // One request at a time per format.
    expect((await org.admin.post(`${org.base}/ai-draft`, { mode: 'CREATE', description: DESCRIPTION }).expect(409)).body.error.code).toBe('AI_JOB_IN_PROGRESS');

    // The first answer prints a field the workflow does not have: it goes back to the model, which fixes it.
    expect(await run(org.tenant.tenantId, jobId, [answer('{{field.NO_EXISTE}}'), answer('{{ticket.title}}')])).toBe('succeeded');
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]!.tool.name).toBe('submit_pdf_format');
    expect(provider.requests[0]!.user).toContain(DESCRIPTION);
    expect(provider.requests[1]!.user).toContain('DOCUMENT_FIELD_UNKNOWN');

    const [done] = await history(org.admin, org.base);
    expect(done).toMatchObject({ kind: 'PDF_FORMAT_DRAFT', status: 'SUCCEEDED', stage: 'WRITING', description: DESCRIPTION, tokens: 2 * (USAGE.promptTokens + USAGE.completionTokens) });
    expect(done!.result).toMatchObject({ rounds: 2, errors: 0, assumptions: ['Supuse tamaño carta.'], decisions: [{ topic: 'SIGNATURES' }] });
    expect((done!.result as { design: { elements: Array<{ id: string; content?: string }> } }).design.elements.map((element) => element.id)).toEqual(['e1', 'e2']);
    // The generic status has no design (only the format's history carries it).
    expect((await org.admin.get(`/ai-jobs/${jobId}`).expect(200)).body).toMatchObject({ kind: 'PDF_FORMAT_DRAFT', status: 'SUCCEEDED', result: null });
    expect((await org.admin.get(org.base).expect(200)).body.design).toEqual(org.saved);
    const ledger = (await db.owner.query('SELECT round, task_kind::text, outcome::text, model FROM ai_usage WHERE job_id = $1 ORDER BY round', [jobId])).rows;
    expect(ledger).toEqual([1, 2].map((round) => ({ round, task_kind: 'PDF_FORMAT_DRAFT', outcome: 'OK', model: 'claude-haiku-5-5' })));
  });

  it('starts a change from the design on screen, and refuses one without it or on a block design', async () => {
    const org = await organization();
    await org.admin.post(`${org.base}/ai-draft`, { mode: 'REVISE', description: 'Agrega la firma' }).expect(400);
    const onScreen = canvas([]);
    const jobId = (await org.admin.post(`${org.base}/ai-draft`, { mode: 'REVISE', description: 'Agrega la firma del cliente', design: onScreen }).expect(202)).body.jobId as string;
    expect(await run(org.tenant.tenantId, jobId, [answer('{{ticket.number}}')])).toBe('succeeded');
    expect(provider.requests[0]!.user).toContain(`<current_format>\n${JSON.stringify(onScreen)}`);
    expect(provider.requests[0]!.system).toContain('CHANGING THE FORMAT ON SCREEN');

    const blocks = (await org.admin.post(`/workflows/${org.workflowId}/pdf-formats`, { name: unique('Bloques'), design: { version: 1, page: { size: 'A4', orientation: 'PORTRAIT', margins: { top: 54, right: 54, bottom: 54, left: 54 } }, defaults: { fontSize: 10 }, body: [{ type: 'text', text: 'ok' }] } }).expect(201)).body as { id: string };
    expect((await org.admin.post(`/workflows/${org.workflowId}/pdf-formats/${blocks.id}/ai-draft`, { description: DESCRIPTION }).expect(422)).body.error.code).toBe('INVALID_STATE');
  });

  it('sends the pictures of a paper format to the model and counts them in the history, without returning them', async () => {
    const org = await organization();
    const picture = { mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };
    await org.admin.post(`${org.base}/ai-draft`, { description: DESCRIPTION, images: [picture, picture, picture, picture] }).expect(400);
    const jobId = (await org.admin.post(`${org.base}/ai-draft`, { description: 'Replica este formato tal como está en la foto.', images: [picture] }).expect(202)).body.jobId as string;
    expect(await run(org.tenant.tenantId, jobId, [answer('{{ticket.title}}')])).toBe('succeeded');
    expect(provider.requests[0]!.images).toEqual([picture]);
    expect(provider.requests[0]!.system).toContain('PICTURES OF A PAPER FORMAT');
    const [done] = await history(org.admin, org.base);
    expect(done).toMatchObject({ images: 1, status: 'SUCCEEDED' });
    expect(JSON.stringify(done)).not.toContain(picture.data);
  });

  it('fails FORMAT_GONE without a paid call when the format was deleted meanwhile', async () => {
    const org = await organization();
    const jobId = (await org.admin.post(`${org.base}/ai-draft`, { description: DESCRIPTION }).expect(202)).body.jobId as string;
    await org.admin.delete(org.base).expect(204);
    expect(await run(org.tenant.tenantId, jobId, [answer('{{ticket.title}}')])).toBe('failed');
    expect(provider.requests).toHaveLength(0);
    expect((await org.admin.get(`/ai-jobs/${jobId}`).expect(200)).body).toMatchObject({ status: 'FAILED', errorCode: 'FORMAT_GONE' });
  });
});
