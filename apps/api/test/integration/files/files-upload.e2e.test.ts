import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { S3ObjectStorage } from '../../../src/infrastructure/storage/s3-object-storage.js';
import { connectTestDatabase } from '../../support/admin-api.js';
import { createTestApp } from '../../support/create-test-app.js';
import { declare, pdf, png, putToStorage, reserve, sha256Of, uploadFile } from '../../support/file-uploads.js';
import { useTestEnvironment } from '../../support/test-environment.js';
import { type Member, TicketWorld, unique } from '../../support/ticket-world.js';

useTestEnvironment();

const GB = 1024 * 1024 * 1024;
const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('uploads: reserve, upload, confirm, quota', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let uploader: Member;
  let other: Member;
  let outsider: Member;
  let outsiderWorld: TicketWorld;
  const storage = new S3ObjectStorage({ ...inject('storage'), forcePathStyle: true });

  const keyOf = async (fileId: string) => (await db.platform.query<{ storage_key: string }>('SELECT storage_key FROM stored_files WHERE id = $1', [fileId])).rows[0]?.storage_key;
  const row = async (fileId: string) => (await db.platform.query<{ status: string; mime_type: string; linked_at: Date | null }>('SELECT status, mime_type, linked_at FROM stored_files WHERE id = $1', [fileId])).rows[0];
  const usage = async (tenantId = world.tenant.tenantId) => (await db.platform.query<{ bytes_used: string; bytes_reserved: string }>('SELECT bytes_used::text, bytes_reserved::text FROM tenant_usage WHERE tenant_id = $1', [tenantId])).rows[0] ?? { bytes_used: '0', bytes_reserved: '0' };

  /** A plan of this size for the tenant: the quota is read from the plan, never from code. */
  const withPlan = async (tenantId: string, baseBytes: number, perUserBytes = 0, gracePercent = 5, extraBytes = 0) => {
    const planId = (await db.platform.query<{ id: string }>(`INSERT INTO plans (code, name, storage_base_bytes, storage_per_user_bytes, storage_grace_percent) VALUES ($1, 'Test', $2, $3, $4) RETURNING id`, [unique('plan'), baseBytes, perUserBytes, gracePercent])).rows[0]!.id;
    await db.platform.query('UPDATE tenants SET plan_id = $1, extra_storage_bytes = $3 WHERE id = $2', [planId, tenantId, extraBytes]);
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [uploader, other] = [await world.member([grant('create')]), await world.member([grant('create')])];
    outsiderWorld = await TicketWorld.create(db, app);
    outsider = await outsiderWorld.member([grant('create')]);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('POST /files/uploads', () => {
    it('reserves a PENDING row with a key fixed by the server, and counts the bytes as reserved', async () => {
      const before = await usage();
      const file = { name: 'contract.pdf', content: pdf('reserve') };
      const [slot] = await reserve(uploader, [file]);
      const stored = (await db.platform.query('SELECT storage_key, status, size_bytes::int, sha256, origin, uploaded_by_id, mime_type FROM stored_files WHERE id = $1', [slot!.fileId])).rows[0];
      expect(stored).toMatchObject({ status: 'PENDING', size_bytes: file.content.length, sha256: sha256Of(file.content), origin: 'USER', uploaded_by_id: uploader.userId, mime_type: 'application/pdf' });
      expect(stored.storage_key).toMatch(new RegExp(`^tenants/${world.tenant.tenantId}/\\d{4}/\\d{2}/${slot!.fileId}$`));
      expect(slot!.method).toBe('PUT');
      expect(BigInt((await usage()).bytes_reserved) - BigInt(before.bytes_reserved)).toBe(BigInt(file.content.length));
    });

    it.each([
      ['an SVG', { files: [{ name: 'logo.svg', sizeBytes: 10, sha256: 'a'.repeat(64) }] }],
      ['a file over 4 MB', { files: [{ name: 'big.pdf', sizeBytes: 4 * 1024 * 1024 + 1, sha256: 'a'.repeat(64) }] }],
      ['16 files', { files: Array.from({ length: 16 }, () => ({ name: 'a.pdf', sizeBytes: 1, sha256: 'a'.repeat(64) })) }],
      ['more than 20 MB in total', { files: Array.from({ length: 6 }, () => ({ name: 'a.pdf', sizeBytes: 4 * 1024 * 1024, sha256: 'a'.repeat(64) })) }],
    ])('rejects %s', async (_label, body) => {
      expect((await uploader.client.post('/files/uploads', body)).status).toBe(400);
    });

    it('needs a permission to put something on a ticket', async () => {
      const reader = await world.member([grant('read_created')]);
      await reader.client.post('/files/uploads', { files: [declare({ name: 'a.pdf', content: pdf() })] }).expect(403);
    });

    it('caps the uploads one person may leave pending', async () => {
      const greedy = await world.member([grant('create')]);
      for (let batch = 0; batch < 3; batch += 1) {
        await greedy.client.post('/files/uploads', { files: Array.from({ length: 15 }, (_v, index) => ({ name: `f${batch}-${index}.pdf`, sizeBytes: 1, sha256: 'a'.repeat(64) })) }).expect(201);
      }
      await greedy.client.post('/files/uploads', { files: Array.from({ length: 6 }, (_v, index) => ({ name: `x${index}.pdf`, sizeBytes: 1, sha256: 'a'.repeat(64) })) }).expect(422);
      await greedy.client.post('/files/uploads', { files: [{ name: 'one.pdf', sizeBytes: 1, sha256: 'a'.repeat(64) }] }).expect(201);
    });
  });

  describe('POST /files/:id/confirm', () => {
    it('verifies the bytes, confirms the file and moves the reservation to used', async () => {
      const before = await usage();
      const content = pdf('confirm me');
      const id = await uploadFile(uploader, { name: 'doc.pdf', content });
      expect(await row(id)).toMatchObject({ status: 'CONFIRMED', mime_type: 'application/pdf' });
      const after = await usage();
      expect(BigInt(after.bytes_used) - BigInt(before.bytes_used)).toBe(BigInt(content.length));
      expect(after.bytes_reserved).toBe(before.bytes_reserved);
    });

    it('answers 409 while the browser has not uploaded yet, and works once it has', async () => {
      const file = { name: 'late.pdf', content: pdf('late') };
      const [slot] = await reserve(uploader, [file]);
      const early = await uploader.client.post(`/files/${slot!.fileId}/confirm`).expect(409);
      expect(early.body.error.code).toBe('FILE_NOT_UPLOADED');
      expect((await row(slot!.fileId))!.status).toBe('PENDING');
      expect((await putToStorage(slot!, file.content)).ok).toBe(true);
      await uploader.client.post(`/files/${slot!.fileId}/confirm`).expect(200);
    });

    it('is idempotent: confirming twice, even at once, moves the usage only once', async () => {
      const before = await usage();
      const file = { name: 'twice.pdf', content: pdf('twice') };
      const [slot] = await reserve(uploader, [file]);
      await putToStorage(slot!, file.content);
      const results = await Promise.all([1, 2, 3].map(() => uploader.client.post(`/files/${slot!.fileId}/confirm`)));
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(BigInt((await usage()).bytes_used) - BigInt(before.bytes_used)).toBe(BigInt(file.content.length));
      await uploader.client.post(`/files/${slot!.fileId}/confirm`).expect(200);
    });

    it('rejects HTML disguised as an image: the row, the reservation and the object are all gone', async () => {
      const before = await usage();
      const file = { name: 'photo.png', content: Buffer.from('<html><script>alert(1)</script></html>') };
      const [slot] = await reserve(uploader, [file]);
      await putToStorage(slot!, file.content);
      const key = (await keyOf(slot!.fileId))!;
      const response = await uploader.client.post(`/files/${slot!.fileId}/confirm`).expect(422);
      expect(response.body.error).toMatchObject({ code: 'FILE_REJECTED', details: { reason: 'TYPE_MISMATCH' } });
      expect(await row(slot!.fileId)).toBeUndefined();
      expect(await storage.head(key)).toBeNull();
      expect(await usage()).toEqual(before);
    });

    it('rejects content whose hash is not the declared one', async () => {
      const before = await usage();
      const file = { name: 'liar.pdf', content: pdf('real'), declaredSha256: sha256Of(pdf('claimed')) };
      const [slot] = await reserve(uploader, [file]);
      await putToStorage(slot!, file.content);
      const response = await uploader.client.post(`/files/${slot!.fileId}/confirm`).expect(422);
      expect(response.body.error.details).toEqual({ reason: 'HASH_MISMATCH' });
      expect(await usage()).toEqual(before);
    });

    it('rejects a PDF declared as .xlsx and binary content declared as .csv', async () => {
      for (const file of [{ name: 'book.xlsx', content: pdf('not a workbook') }, { name: 'data.csv', content: Buffer.from([0x4d, 0x5a, 0x00, 0x01]) }]) {
        const [slot] = await reserve(uploader, [file]);
        await putToStorage(slot!, file.content);
        expect((await uploader.client.post(`/files/${slot!.fileId}/confirm`).expect(422)).body.error.code).toBe('FILE_REJECTED');
      }
    });

    it('never lets a second upload replace what was uploaded', async () => {
      const file = { name: 'once.pdf', content: pdf('original') };
      const [slot] = await reserve(uploader, [file]);
      expect((await putToStorage(slot!, file.content)).ok).toBe(true);
      expect((await putToStorage(slot!, pdf('swapped'))).status).not.toBe(200);
      await uploader.client.post(`/files/${slot!.fileId}/confirm`).expect(200);
    });
  });

  describe('storage quota', () => {
    let quotaWorld: TicketWorld;
    let member: Member;

    beforeAll(async () => {
      quotaWorld = await TicketWorld.create(db, app);
      member = await quotaWorld.member([grant('create')]);
    });

    const reserveBytes = (bytes: number) => member.client.post('/files/uploads', { files: [{ name: 'q.pdf', sizeBytes: bytes, sha256: 'a'.repeat(64) }] });
    const quotaUsage = () => usage(quotaWorld.tenant.tenantId);

    it('allows up to the hard limit (plan limit plus 5 %), flags the margin, and refuses beyond it', async () => {
      await withPlan(quotaWorld.tenant.tenantId, 1000, 0, 5);
      // The tenant has two members (the administrator and this one) but no per-user storage.
      expect((await reserveBytes(1000)).body.quota).toEqual({ overLimit: false });
      const margin = await reserveBytes(50);
      expect(margin.status).toBe(201);
      expect(margin.body.quota).toEqual({ overLimit: true });
      const refused = await reserveBytes(1);
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
      expect((await quotaUsage()).bytes_reserved).toBe('1050');
    });

    it('counts per-user storage and the extra storage bought, live', async () => {
      await db.platform.query('DELETE FROM stored_files WHERE tenant_id = $1', [quotaWorld.tenant.tenantId]);
      await db.platform.query('UPDATE tenant_usage SET bytes_reserved = 0, bytes_used = 0 WHERE tenant_id = $1', [quotaWorld.tenant.tenantId]);
      await withPlan(quotaWorld.tenant.tenantId, 0, 100, 0, 50);
      const members = (await db.platform.query<{ count: string }>(`SELECT count(*)::text FROM memberships WHERE tenant_id = $1 AND status = 'ACTIVE'`, [quotaWorld.tenant.tenantId])).rows[0]!.count;
      const limit = Number(members) * 100 + 50;
      expect((await reserveBytes(limit + 1)).status).toBe(422);
      expect((await reserveBytes(limit)).status).toBe(201);
    });

    it('counts a logically deleted file and a system file, like any other', async () => {
      await db.platform.query('DELETE FROM stored_files WHERE tenant_id = $1', [quotaWorld.tenant.tenantId]);
      await db.platform.query('UPDATE tenant_usage SET bytes_reserved = 0, bytes_used = 0 WHERE tenant_id = $1', [quotaWorld.tenant.tenantId]);
      await withPlan(quotaWorld.tenant.tenantId, 1000, 0, 0);
      const content = pdf('deleted');
      const id = await uploadFile(member, { name: 'old.pdf', content });
      await db.platform.query(`UPDATE stored_files SET status = 'DELETED', deleted_at = now() WHERE id = $1`, [id]);
      expect((await quotaUsage()).bytes_used).toBe(String(content.length));
      expect((await reserveBytes(1000 - content.length + 1)).status).toBe(422);
      expect((await reserveBytes(1000 - content.length)).status).toBe(201);
    });

    it('never lets parallel reservations pass the hard limit, and the counter equals what they reserved', async () => {
      const raceWorld = await TicketWorld.create(db, app);
      const racer = await raceWorld.member([grant('create')]);
      await withPlan(raceWorld.tenant.tenantId, 1000, 0, 0);
      const attempts = await Promise.all(Array.from({ length: 12 }, () => racer.client.post('/files/uploads', { files: [{ name: 'r.pdf', sizeBytes: 300, sha256: 'a'.repeat(64) }] })));
      const accepted = attempts.filter((attempt) => attempt.status === 201).length;
      expect(accepted).toBe(3);
      expect(attempts.filter((attempt) => attempt.status === 422)).toHaveLength(9);
      expect((await usage(raceWorld.tenant.tenantId)).bytes_reserved).toBe(String(accepted * 300));
    });

    it('a rejected upload gives its reservation back, so the space can be used again', async () => {
      const refundWorld = await TicketWorld.create(db, app);
      const refunded = await refundWorld.member([grant('create')]);
      await withPlan(refundWorld.tenant.tenantId, 100, 0, 0);
      const bad = { name: 'x.png', content: Buffer.alloc(100, 0x41) };
      const [slot] = await reserve(refunded, [bad]);
      await putToStorage(slot!, bad.content);
      await refunded.client.post(`/files/${slot!.fileId}/confirm`).expect(422);
      await refunded.client.post('/files/uploads', { files: [{ name: 'again.pdf', sizeBytes: 100, sha256: 'a'.repeat(64) }] }).expect(201);
    });

    it('GET /storage/usage reports used, reserved, the limits, the active users and the state', async () => {
      const usageWorld = await TicketWorld.create(db, app);
      await withPlan(usageWorld.tenant.tenantId, GB, GB, 5);
      const content = pdf('usage');
      const owner = await usageWorld.member([grant('create')]);
      await uploadFile(owner, { name: 'u.pdf', content });
      const response = await usageWorld.admin.get('/storage/usage').expect(200);
      const users = response.body.activeUsers as number;
      expect(users).toBeGreaterThanOrEqual(2);
      expect(response.body).toEqual({
        usedBytes: String(content.length),
        reservedBytes: '0',
        limitBytes: String(GB + GB * users),
        hardLimitBytes: String(Math.floor((GB + GB * users) * 1.05)),
        activeUsers: users,
        state: 'OK',
      });
    });

    it('GET /storage/usage needs the permission to see it', async () => {
      await member.client.get('/storage/usage').expect(403);
    });
  });

  describe('tenant isolation', () => {
    it('another user of the same tenant cannot confirm a file they did not reserve', async () => {
      const file = { name: 'mine.pdf', content: pdf('mine') };
      const [slot] = await reserve(uploader, [file]);
      await putToStorage(slot!, file.content);
      await other.client.post(`/files/${slot!.fileId}/confirm`).expect(404);
      expect((await row(slot!.fileId))!.status).toBe('PENDING');
    });

    it("another tenant cannot confirm this tenant's file: it looks like a missing one", async () => {
      const file = { name: 'ours.pdf', content: pdf('ours') };
      const [slot] = await reserve(uploader, [file]);
      await putToStorage(slot!, file.content);
      const foreign = await outsider.client.post(`/files/${slot!.fileId}/confirm`).expect(404);
      const missing = await outsider.client.post('/files/0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90/confirm').expect(404);
      expect(foreign.body.error).toMatchObject({ code: missing.body.error.code, message: missing.body.error.message });
      expect((await row(slot!.fileId))!.status).toBe('PENDING');
    });

    it("reservations land in the caller's tenant only, and one tenant's quota never counts another's files", async () => {
      const before = await usage(outsiderWorld.tenant.tenantId);
      await reserve(uploader, [{ name: 'noise.pdf', content: pdf('noise') }]);
      expect(await usage(outsiderWorld.tenant.tenantId)).toEqual(before);
    });

    it("GET /storage/usage shows the caller's tenant only", async () => {
      await withPlan(outsiderWorld.tenant.tenantId, 777, 0, 0);
      const mine = (await world.admin.get('/storage/usage').expect(200)).body;
      const theirs = (await outsiderWorld.admin.get('/storage/usage').expect(200)).body;
      expect(theirs.limitBytes).toBe(String(777 + 0));
      expect(mine.limitBytes).not.toBe(theirs.limitBytes);
    });
  });
});
