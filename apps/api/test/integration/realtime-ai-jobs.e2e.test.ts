import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { AI_NOTICE_VERSION, type AiDraftSubscribeAck, type AiJobChangedPayload } from '@procesabpm/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { SignalRouter } from '../../src/modules/realtime/application/signal-router.js';
import { adminOf, type ApiClient, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { connected, connectSocket, emitWithAck, nextEvent, notifySignal, recordEvents, startListening } from '../support/realtime-client.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ AI_ASSISTANT_AVAILABLE: 'true' });

const DESCRIPTION = 'El asesor pide un anticipo de viaje, lo aprueba su jefe y el tesorero lo paga.';
const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

describe('realtime «Crear con IA»: the followers of a draft hear about its requests, with ids only', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];

  const organization = async () => {
    const { tenant, admin } = await adminOf(db, app);
    await admin.put('/settings/ai-assistant', { enabled: true, acceptedNoticeVersion: AI_NOTICE_VERSION }).expect(200);
    const category = (await admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
    return { tenant, admin, versionId: workflow.versions[0].id as string, base: `/workflows/${workflow.id}/versions/${workflow.versions[0].id}` };
  };
  const open = async (client: ApiClient): Promise<Socket> => {
    const socket = connectSocket(url, client.accessToken);
    sockets.push(socket);
    await connected(socket);
    return socket;
  };
  const follow = (socket: Socket, versionId: string) => emitWithAck<AiDraftSubscribeAck>(socket, 'ai_draft.subscribe', { versionId });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    url = await startListening(app);
  });
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('a request and its cancel reach every follower who may edit workflows, as ids only', async () => {
    const org = await organization();
    const designer = await clientWith(db, app, org.tenant, [{ action: 'update', subject: 'Workflow' }]);
    const [adminSocket, designerSocket] = [await open(org.admin), await open(designer)];
    expect(await follow(adminSocket, org.versionId)).toEqual({ ok: true });
    expect(await follow(designerSocket, org.versionId)).toEqual({ ok: true });

    const created = nextEvent<AiJobChangedPayload>(designerSocket, 'ai_job.changed');
    const { jobId } = (await org.admin.post(`${org.base}/ai-draft`, { description: DESCRIPTION, revision: 0 }).expect(202)).body as { jobId: string };
    const payload = await created;
    expect(payload).toEqual({ jobId, versionId: org.versionId });
    expect(JSON.stringify(payload)).not.toContain('anticipo');

    const cancelled = nextEvent<AiJobChangedPayload>(adminSocket, 'ai_job.changed');
    await designer.post(`/ai-jobs/${jobId}/cancel`, {}).expect(200);
    expect(await cancelled).toEqual({ jobId, versionId: org.versionId });
  });

  it('a member who may only read workflows cannot follow; an unfollowed or another tenant’s socket hears nothing, even forged', async () => {
    const a = await organization();
    const b = await organization();
    const reader = await clientWith(db, app, a.tenant, [{ action: 'read', subject: 'Workflow' }]);
    expect(await follow(await open(reader), a.versionId)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await emitWithAck(await open(a.admin), 'ai_draft.subscribe', { versionId: 'nope' })).toEqual({ ok: false, code: 'VALIDATION_FAILED' });

    const intruder = await open(b.admin);
    expect(await follow(intruder, a.versionId)).toEqual({ ok: true });
    const heard = recordEvents(intruder);
    const owner = await open(a.admin);
    await follow(owner, a.versionId);
    const control = nextEvent<AiJobChangedPayload>(owner, 'ai_job.changed');
    await notifySignal(inject('runtimeUrl'), { v: 1, k: 'ai_job', t: b.tenant.tenantId, id: randomUUID(), w: randomUUID() });
    await a.admin.post(`${a.base}/ai-draft`, { description: DESCRIPTION, revision: 0 }).expect(202);
    await control;
    await app.get(SignalRouter).whenIdle();
    expect(heard.filter(([event]) => event === 'ai_job.changed')).toEqual([]);
  });
});
