import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LOG_WRITER } from '../../../src/common/logging/json-logger.js';
import { S3ObjectStorage } from '../../../src/infrastructure/storage/s3-object-storage.js';
import { FilePurgeJob } from '../../../src/modules/files/application/file-purge.job.js';
import { WorkerModule } from '../../../src/worker.module.js';
import { connectTestDatabase } from '../../support/admin-api.js';
import { createTestApp } from '../../support/create-test-app.js';
import { pdf, putToStorage, reserve, uploadFile } from '../../support/file-uploads.js';
import { useTestEnvironment } from '../../support/test-environment.js';
import { type Member, publishFlow, simpleFlow, TicketWorld } from '../../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('purge of abandoned uploads (worker)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let worker: TestingModule;
  let job: FilePurgeJob;
  let world: TicketWorld;
  let member: Member;
  const storage = new S3ObjectStorage({ ...inject('storage'), forcePathStyle: true });

  const keyOf = async (id: string) => (await db.platform.query<{ storage_key: string }>('SELECT storage_key FROM stored_files WHERE id = $1', [id])).rows[0]?.storage_key;
  const exists = async (id: string) => ((await db.platform.query('SELECT 1 FROM stored_files WHERE id = $1', [id])).rowCount ?? 0) > 0;
  const usage = async (tenantId = world.tenant.tenantId) => (await db.platform.query<{ bytes_used: string; bytes_reserved: string }>('SELECT bytes_used::text, bytes_reserved::text FROM tenant_usage WHERE tenant_id = $1', [tenantId])).rows[0]!;
  /** created_at is immutable for everyone but the owner: the rows are backdated by a superuser connection with triggers off. */
  const age = async (ids: string[]) => {
    const client = await db.owner.connect();
    try {
      await client.query(`SET session_replication_role = replica`);
      await client.query(`UPDATE stored_files SET created_at = now() - interval '2 days' WHERE id = ANY($1::uuid[])`, [ids]);
    } finally {
      await client.query(`RESET session_replication_role`);
      client.release();
    }
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).compile();
    await worker.init();
    job = worker.get(FilePurgeJob);
    world = await TicketWorld.create(db, app);
    member = await world.member([grant('create'), grant('read_created')]);
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await db.close();
  });

  it('removes old PENDING and never-linked CONFIRMED files with their objects, and releases their quota', async () => {
    const pendingFile = { name: 'pending.pdf', content: pdf('pending') };
    const [slot] = await reserve(member, [pendingFile]);
    await putToStorage(slot!, pendingFile.content);
    const confirmed = await uploadFile(member, { name: 'confirmed.pdf', content: pdf('confirmed') });
    const keys = [(await keyOf(slot!.fileId))!, (await keyOf(confirmed))!];
    await age([slot!.fileId, confirmed]);

    const result = await job.runOnce();
    expect(result.failed).toBe(0);
    expect(result.files).toBeGreaterThanOrEqual(2);
    expect(await exists(slot!.fileId)).toBe(false);
    expect(await exists(confirmed)).toBe(false);
    for (const key of keys) expect(await storage.head(key)).toBeNull();
    expect(await usage()).toEqual({ bytes_used: '0', bytes_reserved: '0' });
  });

  it('keeps recent uploads, linked files and files something else refers to', async () => {
    const recent = await uploadFile(member, { name: 'recent.pdf', content: pdf('recent') });
    const attached = await uploadFile(member, { name: 'attached.pdf', content: pdf('attached') });
    const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'CREATOR' }));
    await member.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'T', values: {}, attachments: [attached] }).expect(201);
    const signature = await uploadFile(member, { name: 'signature.png', content: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('sig')]) });
    await db.platform.query('UPDATE memberships SET signature_file_id = $1 WHERE tenant_id = $2 AND user_id = $3', [signature, world.tenant.tenantId, member.userId]);
    await age([attached, signature]);
    const keys = await Promise.all([recent, attached, signature].map(keyOf));

    await job.runOnce();
    for (const id of [recent, attached, signature]) expect(await exists(id), id).toBe(true);
    for (const key of keys) expect(await storage.head(key!)).not.toBeNull();
  });

  it('cleans every tenant inside its own context and leaves the other tenants counters alone', async () => {
    const otherWorld = await TicketWorld.create(db, app);
    const stranger = await otherWorld.member([grant('create')]);
    const mine = await uploadFile(member, { name: 'mine.pdf', content: pdf('mine') });
    const theirs = await uploadFile(stranger, { name: 'theirs.pdf', content: pdf('theirs') });
    const strangerUsage = await usage(otherWorld.tenant.tenantId);
    await age([mine]);

    await job.runOnce();
    expect(await exists(mine)).toBe(false);
    expect(await exists(theirs)).toBe(true);
    expect(await usage(otherWorld.tenant.tenantId)).toEqual(strangerUsage);
  });

  it('is safe to run twice at once: every file is purged once and the counter never goes negative', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) ids.push(await uploadFile(member, { name: `p${index}.pdf`, content: pdf(`p${index}`) }));
    await age(ids);
    const results = await Promise.all([job.runOnce(), job.runOnce()]);
    expect(results.reduce((total, result) => total + result.failed, 0)).toBe(0);
    for (const id of ids) expect(await exists(id)).toBe(false);
    const counter = await usage();
    expect(BigInt(counter.bytes_used)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(counter.bytes_reserved)).toBeGreaterThanOrEqual(0n);
  });
});
