import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { AI_NOTICE_VERSION, refsFromStepNames, type VersionDetailResponse, type WorkflowDraftSpec } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { advanceSpec } from '../../../../packages/shared/src/workflow/draft-spec/test-fixtures.js';
import { JsonLogger, LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { LlmCallError, LlmProvider, type LlmRequest, type LlmResult, type ToolArgumentsListener } from '../../src/infrastructure/llm/llm-provider.js';
import { WorkflowDraftJob } from '../../src/modules/ai-assistant/application/workflow-draft.job.js';
import type { AiJobClaim } from '../../src/modules/ai-assistant/data/ai-job-claims.repository.js';
import { AiJobWorkRepository } from '../../src/modules/ai-assistant/data/ai-job-work.repository.js';
import { WorkerModule } from '../../src/worker.module.js';
import { adminOf, type ApiClient, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ AI_ASSISTANT_AVAILABLE: 'true' });

const USAGE = { promptTokens: 3500, cachedPromptTokens: 100, completionTokens: 9000, reasoningTokens: 6500 };
const DESCRIPTION = 'El asesor pide un anticipo de viaje y el tesorero lo paga.';
const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

/** Answers from a script, like the provider would; it never leaves the test. */
class ScriptedProvider extends LlmProvider {
  readonly name = 'deepseek';
  readonly model = 'deepseek-v4-pro';
  script: Array<WorkflowDraftSpec | LlmCallError> = [];
  readonly requests: LlmRequest[] = [];
  /** Runs while a call is in flight (e.g. the request expires meanwhile). */
  duringCall: (() => Promise<void>) | undefined;
  /** Runs after the answer's tool arguments were streamed, before the call ends. */
  afterStreaming: (() => Promise<void>) | undefined;

  async complete(request: LlmRequest, _signal: AbortSignal, onArguments?: ToolArgumentsListener): Promise<LlmResult> {
    this.requests.push(request);
    await this.duringCall?.();
    const next = this.script.shift();
    if (next === undefined) throw new Error('no scripted answer left');
    if (next instanceof LlmCallError) throw next;
    if (this.afterStreaming !== undefined) {
      onArguments?.(JSON.stringify(next));
      await this.afterStreaming();
    }
    return { answer: { kind: 'tool_call', arguments: next }, usage: USAGE, durationMs: 2_000 };
  }
}

describe('«Crear con IA»: the worker turns a request into a draft', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let worker: TestingModule;
  const provider = new ScriptedProvider();

  /** An organization with the catalog names the scripted drafts use, the assistant on, and a fresh draft. */
  async function organization() {
    const { tenant, admin } = await adminOf(db, app);
    for (const name of ['Gerente general', 'Contador', 'Tesorero']) await admin.post('/positions', { name }).expect(201);
    await admin.post('/groups', { name: 'Mesa TI' }).expect(201);
    await admin.post('/approval-group-types', { name: 'Jefatura' }).expect(201);
    await admin.put('/settings/ai-assistant', { enabled: true, acceptedNoticeVersion: AI_NOTICE_VERSION }).expect(200);
    const category = (await admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
    const base = `/workflows/${workflow.id}/versions/${workflow.versions[0].id}`;
    const jobId = (await admin.post(`${base}/ai-draft`, { description: DESCRIPTION, revision: 0 }).expect(202)).body.jobId as string;
    return { tenant, admin, base, jobId };
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
  const runJob = async (org: { tenant: { tenantId: string }; jobId: string }, script: ScriptedProvider['script'], duringCall?: () => Promise<void>) => {
    provider.script = [...script];
    provider.requests.length = 0;
    provider.duringCall = duringCall;
    provider.afterStreaming = undefined;
    return worker.get(WorkflowDraftJob).run(await claim(org.tenant.tenantId, org.jobId));
  };
  const job = async (admin: ApiClient, jobId: string) => (await admin.get(`/ai-jobs/${jobId}`).expect(200)).body;
  const ledger = async (jobId: string) => (await db.owner.query('SELECT round, outcome, prompt_tokens, completion_tokens, reasoning_tokens, error_code, model FROM ai_usage WHERE job_id = $1 ORDER BY round', [jobId])).rows;
  const input = async (jobId: string) => (await db.owner.query('SELECT input FROM ai_jobs WHERE id = $1', [jobId])).rows[0].input;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .overrideProvider(LlmProvider)
      .useValue(provider)
      .compile();
    await worker.init();
  });
  afterAll(async () => {
    await worker.close();
    await app.close();
    await db.close();
  });

  it('writes the draft, finishes the request with its summary and records the tokens of the call', async () => {
    const org = await organization();
    expect(await runJob(org, [advanceSpec()])).toBe('succeeded');

    const done = await job(org.admin, org.jobId);
    expect(done).toMatchObject({ status: 'SUCCEEDED', stage: 'WRITING', round: 1, problems: null, errorCode: null, result: { revision: 1, rounds: 1, corrections: 0, errors: 0, assumptions: advanceSpec().assumptions, decisions: advanceSpec().decisions, outline: { steps: 7, approvals: 2, fields: advanceSpec().fields.length, initiators: 0, amountRules: 0 } } });
    const version = (await org.admin.get(org.base).expect(200)).body as VersionDetailResponse;
    expect(version.version.revision).toBe(1);
    expect(version.document.steps).toHaveLength(9);
    expect(version.validation).toEqual({ errors: [], warnings: [] });
    expect(await ledger(org.jobId)).toEqual([{ round: 1, outcome: 'OK', prompt_tokens: 3500, completion_tokens: 9000, reasoning_tokens: 6500, error_code: null, model: 'deepseek-v4-pro' }]);
    expect(await input(org.jobId)).toEqual({ description: DESCRIPTION });
    expect((await org.admin.get('/settings/ai-assistant').expect(200)).body.today).toEqual({ jobs: 1, tokens: 12_500 });
    expect((await org.admin.get('/settings/ai-assistant/usage').expect(200)).body.recentJobs).toEqual([expect.objectContaining({ id: org.jobId, tokens: 12_500 })]);
    expect(provider.requests[0]!.user).toContain('- Tesorero');
    await org.admin.post(`${org.base}/publish`, {}).expect(200);
  });

  it('shows the diagram so far while the model writes it, to the organization only, and clears it once the round ends', async () => {
    const org = await organization();
    const other = await organization();
    const seen: unknown[] = [];
    provider.script = [advanceSpec()];
    provider.requests.length = 0;
    provider.duringCall = undefined;
    provider.afterStreaming = async () => {
      await vi.waitFor(async () => expect((await job(org.admin, org.jobId)).preview).not.toBeNull(), { timeout: 5_000 });
      seen.push((await job(org.admin, org.jobId)).preview);
      await other.admin.get(`/ai-jobs/${org.jobId}`).expect(404);
    };
    const logged = vi.spyOn(worker.get(JsonLogger), 'info');
    onTestFinished(() => logged.mockRestore());
    expect(await worker.get(WorkflowDraftJob).run(await claim(org.tenant.tenantId, org.jobId))).toBe('succeeded');
    // The log says how the answer arrived and what became of the previews, so a missing diagram can be traced.
    const event = (name: string) => logged.mock.calls.find(([message, fields]) => message === name && (fields as { jobId?: string }).jobId === org.jobId)?.[1];
    expect(event('ai_job.call')).toMatchObject({ round: 1, previews: 1 });
    expect(event('ai_job.previews')).toEqual(expect.objectContaining({ written: 1, refused: 0, failed: 0 }));
    expect(JSON.stringify(logged.mock.calls)).not.toContain('Solicitud de anticipo');
    expect(seen).toEqual([
      {
        steps: advanceSpec().steps.map(({ ref, type, name }) => ({ ref, type, name })),
        transitions: advanceSpec().transitions.map(({ from, to, label }) => ({ from, to, label })),
      },
    ]);
    expect(await job(org.admin, org.jobId)).toMatchObject({ status: 'SUCCEEDED', preview: null });
  });

  it('corrects a draft with problems in a second round, showing each stage on the request, and records both calls', async () => {
    const org = await organization();
    const broken = advanceSpec();
    const seen: unknown[] = [];
    const look = async () => {
      const { stage, round, problems } = await job(org.admin, org.jobId);
      seen.push({ stage, round, problems: problems === null ? null : problems > 0 });
    };
    expect(await runJob(org, [{ ...broken, transitions: broken.transitions.filter((transition) => transition.from !== 'pago') }, advanceSpec()], look)).toBe('succeeded');
    expect(seen).toEqual([
      { stage: 'DESIGNING', round: 1, problems: null },
      { stage: 'DESIGNING', round: 2, problems: null },
    ]);
    const { result } = await job(org.admin, org.jobId);
    expect(result).toMatchObject({ rounds: 2, errors: 0 });
    expect(result!.corrections).toBeGreaterThan(0);
    expect((await ledger(org.jobId)).map((row) => row.round)).toEqual([1, 2]);
    expect(provider.requests[1]!.user).toContain('PEOPLE_BLOCK_WITHOUT_DECISION at step "pago"');
  });

  it('does not overwrite a draft someone edited after asking (DRAFT_CHANGED), but still records the call', async () => {
    const org = await organization();
    const before = (await org.admin.get(org.base).expect(200)).body as VersionDetailResponse;
    await org.admin.put(`${org.base}/graph`, { revision: 0, steps: before.document.steps.map(({ id, type, name }) => ({ id, type, name: `${name} editado` })), transitions: before.document.transitions.map(({ id, fromStepId, toStepId, type, label }) => ({ id, fromStepId, toStepId, type, label })) }).expect(200);
    expect(await runJob(org, [advanceSpec()])).toBe('failed');
    expect(await job(org.admin, org.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'DRAFT_CHANGED', result: null });
    expect(((await org.admin.get(org.base).expect(200)).body as VersionDetailResponse).document.steps.every((step) => step.name.endsWith('editado'))).toBe(true);
    expect(await ledger(org.jobId)).toHaveLength(1);
  });

  it('ends without a key (AI_NOT_CONFIGURED) and when the organization turned the assistant off (AI_DISABLED)', async () => {
    const unconfigured = await organization();
    expect(await runJob(unconfigured, [new LlmCallError('NOT_CONFIGURED', 0)])).toBe('failed');
    expect(await job(unconfigured.admin, unconfigured.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'AI_NOT_CONFIGURED' });

    const turnedOff = await organization();
    await turnedOff.admin.put('/settings/ai-assistant', { enabled: false }).expect(200);
    expect(await runJob(turnedOff, [advanceSpec()])).toBe('failed');
    expect(await job(turnedOff.admin, turnedOff.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'AI_DISABLED' });
    expect(await ledger(turnedOff.jobId)).toEqual([]);
    expect(provider.requests).toEqual([]);
    expect(await input(turnedOff.jobId)).toEqual({ description: DESCRIPTION });
  });

  it('stops a request cancelled while its call was in flight: the call stays in the ledger, the draft and the result do not change', async () => {
    const org = await organization();
    const broken = advanceSpec();
    const cancel = async () => {
      await org.admin.post(`/ai-jobs/${org.jobId}/cancel`, {}).expect(200);
    };
    expect(await runJob(org, [{ ...broken, transitions: broken.transitions.filter((transition) => transition.from !== 'pago') }, advanceSpec()], cancel)).toBe('interrupted');
    expect(await job(org.admin, org.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'CANCELLED', result: null, stage: 'DESIGNING', round: 1 });
    expect(await ledger(org.jobId)).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
    expect(((await org.admin.get(org.base).expect(200)).body as VersionDetailResponse).version.revision).toBe(0);
  });

  it('does not write the draft of a request cancelled during its last call', async () => {
    const org = await organization();
    const cancel = async () => {
      await org.admin.post(`/ai-jobs/${org.jobId}/cancel`, {}).expect(200);
    };
    expect(await runJob(org, [advanceSpec()], cancel)).toBe('interrupted');
    expect(await job(org.admin, org.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'CANCELLED', result: null });
    expect(await ledger(org.jobId)).toHaveLength(1);
    expect(((await org.admin.get(org.base).expect(200)).body as VersionDetailResponse).version.revision).toBe(0);
  });

  it('records a paid call that was in flight when the request expired, and leaves the draft alone', async () => {
    const org = await organization();
    const expire = async () => {
      await db.owner.query(`UPDATE ai_jobs SET status = 'FAILED', error_code = 'LEASE_EXPIRED', claim_token = NULL, lease_until = NULL, completed_at = now() WHERE id = $1`, [org.jobId]);
    };
    expect(await runJob(org, [advanceSpec()], expire)).toBe('interrupted');
    expect(await job(org.admin, org.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'LEASE_EXPIRED' });
    expect(await ledger(org.jobId)).toEqual([{ round: 1, outcome: 'OK', prompt_tokens: 3500, completion_tokens: 9000, reasoning_tokens: 6500, error_code: null, model: 'deepseek-v4-pro' }]);
    expect(((await org.admin.get(org.base).expect(200)).body as VersionDetailResponse).version.revision).toBe(0);
  });

  it('logs the token counts of a call the ledger refused, without its content, and still finishes the request', async () => {
    const org = await organization();
    const refused = vi.spyOn(worker.get(AiJobWorkRepository), 'recordUsage').mockRejectedValueOnce(new Error('ledger down'));
    const warned = vi.spyOn(worker.get(JsonLogger), 'warn');
    let warnings: Array<Parameters<JsonLogger['warn']>> = [];
    try {
      expect(await runJob(org, [advanceSpec()])).toBe('succeeded');
    } finally {
      warnings = [...warned.mock.calls];
      refused.mockRestore();
      warned.mockRestore();
    }
    const lost = warnings.find(([message]) => message === 'ai_job.usage_not_recorded');
    expect(lost?.[1]).toMatchObject({ jobId: org.jobId, round: 1, promptTokens: 3500, completionTokens: 9000, reasoningTokens: 6500, model: 'deepseek-v4-pro' });
    expect(JSON.stringify(warnings)).not.toContain('anticipo');
    expect(await ledger(org.jobId)).toEqual([]);
  });

  describe('a revision of the current draft', () => {
    /** An organization whose first request already wrote the advance draft (revision 1), and a revision asked of it. */
    async function revised(change = 'agrega un aviso al jefe cuando se pague') {
      const org = await organization();
      expect(await runJob(org, [advanceSpec()])).toBe('succeeded');
      const jobId = (await org.admin.post(`${org.base}/ai-draft`, { mode: 'REVISE', description: change, revision: 1 }).expect(202)).body.jobId as string;
      return { ...org, first: org.jobId, jobId, change };
    }
    const withExtraNotice = (): WorkflowDraftSpec => {
      const spec = advanceSpec();
      return {
        ...spec,
        decisions: [{ topic: 'NOTIFICATIONS', text: 'Agregué un aviso al jefe después del pago.' }],
        steps: [...spec.steps, { ...spec.steps.find((step) => step.ref === 'aviso')!, ref: 'aviso_jefe', name: 'Avisar al jefe' }],
        transitions: [...spec.transitions.filter((transition) => transition.from !== 'aviso'), { ...spec.transitions.find((transition) => transition.from === 'aviso')!, to: 'aviso_jefe' }, { ...spec.transitions.find((transition) => transition.from === 'aviso')!, from: 'aviso_jefe' }],
      };
    };
    /** A spec with the refs the platform derives from step names, as the model gets (and keeps) them in a revision. */
    const withRefsFromNames = (spec: WorkflowDraftSpec): WorkflowDraftSpec => {
      const refs = refsFromStepNames(spec.steps.map((step) => ({ id: step.ref, name: step.name })));
      const ref = (value: string) => refs.get(value) ?? value;
      const refOrNull = (value: string | null) => (value === null ? null : ref(value));
      return {
        ...spec,
        steps: spec.steps.map((step) => ({ ...step, ref: ref(step.ref), assignment: step.assignment === null ? null : { ...step.assignment, sameAsStep: refOrNull(step.assignment.sameAsStep) } })),
        transitions: spec.transitions.map((transition) => ({ ...transition, from: ref(transition.from), to: ref(transition.to) })),
        fields: spec.fields.map((field) => ({ ...field, step: ref(field.step) })),
        amountRules: spec.amountRules.map((rule) => ({ ...rule, step: refOrNull(rule.step), approvalStep: refOrNull(rule.approvalStep) })),
      };
    };
    const kindsInLedger = async (jobId: string) => (await db.owner.query<{ task_kind: string }>('SELECT DISTINCT task_kind FROM ai_usage WHERE job_id = $1', [jobId])).rows.map((row) => row.task_kind);

    it('sends the current draft from the database with the change and the earlier requests, and writes the whole revised draft', async () => {
      const org = await revised();
      expect(await runJob(org, [withExtraNotice()])).toBe('succeeded');

      const prompt = provider.requests[0]!;
      expect(prompt.system).toContain('REVISING AN EXISTING DRAFT');
      const current = JSON.parse(/<current_draft>\n(.*)\n<\/current_draft>/s.exec(prompt.user)![1]!) as WorkflowDraftSpec;
      expect(current.steps.map((step) => step.ref)).toContain('aprobacion_del_jefe');
      expect(current.steps).toHaveLength(advanceSpec().steps.length);
      expect(JSON.stringify(current)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(prompt.user).toContain(`<previous_requests>\n- (applied) ${DESCRIPTION} Changed: ${advanceSpec().decisions.map((decision) => decision.text).join(' ')}\n</previous_requests>`);
      expect(prompt.user).toContain(`<change_request>\n${org.change}\n</change_request>`);

      expect(await job(org.admin, org.jobId)).toMatchObject({ kind: 'WORKFLOW_DRAFT_REVISION', status: 'SUCCEEDED', result: { revision: 2, decisions: withExtraNotice().decisions } });
      const version = (await org.admin.get(org.base).expect(200)).body as VersionDetailResponse;
      expect(version.document.steps.map((step) => step.name)).toContain('Avisar al jefe');
      expect(version.validation?.errors).toEqual([]);
      expect(await kindsInLedger(org.jobId)).toEqual(['WORKFLOW_DRAFT_REVISION']);
      expect(await kindsInLedger(org.first)).toEqual(['WORKFLOW_DRAFT']);
    });

    it('keeps the settings the AI does not see on the steps it left alone, and says which ones it kept and lost', async () => {
      const org = await revised();
      const versionId = org.base.split('/').at(-1);
      await db.owner.query(`UPDATE steps SET close_rule = 'ALLOWED' WHERE version_id = $1 AND name = 'Revisión contable'`, [versionId]);
      await db.owner.query(`UPDATE steps SET close_rule = 'ALLOWED' WHERE version_id = $1 AND name = 'Pago del anticipo'`, [versionId]);
      const notice = withRefsFromNames(withExtraNotice());
      const answer: WorkflowDraftSpec = { ...notice, steps: notice.steps.map((step) => (step.name === 'Pago del anticipo' ? { ...step, instructions: 'Paga y adjunta el comprobante.' } : step)) };
      expect(await runJob(org, [answer])).toBe('succeeded');

      expect(provider.requests[0]!.user).toMatch(/<hidden_settings>\n- step (revision_contable|pago_del_anticipo)\n- step (revision_contable|pago_del_anticipo)\n<\/hidden_settings>/);
      const steps = ((await org.admin.get(org.base).expect(200)).body as VersionDetailResponse).document.steps;
      expect(steps.find((step) => step.name === 'Revisión contable')?.closeRule).toBe('ALLOWED');
      expect(steps.find((step) => step.name === 'Pago del anticipo')?.closeRule).toBe('NOT_ALLOWED');
      expect(await job(org.admin, org.jobId)).toMatchObject({
        status: 'SUCCEEDED',
        result: { keptSettings: [{ subject: 'STEP', name: 'Revisión contable', properties: ['closeRule'] }], droppedSettings: [{ subject: 'STEP', name: 'Pago del anticipo', properties: ['closeRule'] }] },
      });
    });

    it('ends before any paid call when the draft changed, or holds what the spec cannot carry, since it was asked', async () => {
      const changed = await revised();
      await db.owner.query('UPDATE workflow_versions SET revision = revision + 1 WHERE id = $1', [changed.base.split('/').at(-1)]);
      expect(await runJob(changed, [withExtraNotice()])).toBe('failed');
      expect(await job(changed.admin, changed.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'DRAFT_CHANGED' });

      const lossy = await revised();
      await db.owner.query(`UPDATE positions SET is_active = false WHERE id IN (SELECT position_id FROM steps WHERE version_id = $1 AND name = 'Revisión contable')`, [lossy.base.split('/').at(-1)]);
      expect(await runJob(lossy, [withExtraNotice()])).toBe('failed');
      expect(await job(lossy.admin, lossy.jobId)).toMatchObject({ status: 'FAILED', errorCode: 'AI_DRAFT_NOT_REVISABLE' });

      expect(provider.requests).toEqual([]);
      expect(await ledger(changed.jobId)).toEqual([]);
      expect(await ledger(lossy.jobId)).toEqual([]);
      expect(((await lossy.admin.get(lossy.base).expect(200)).body as VersionDetailResponse).version.revision).toBe(1);
    });
  });
});
