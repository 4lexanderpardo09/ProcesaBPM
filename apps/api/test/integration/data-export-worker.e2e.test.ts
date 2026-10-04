import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectStorage } from '../../src/infrastructure/storage/object-storage.js';
import { DataExportJob } from '../../src/modules/data-exports/application/data-export.job.js';
import { DataExportScheduler } from '../../src/modules/data-exports/application/data-export.scheduler.js';
import { ExportDataRepository } from '../../src/modules/data-exports/data/export-data.repository.js';
import { EXPORT_DATASETS } from '../../src/modules/data-exports/domain/export-datasets.js';
import { RetentionJob } from '../../src/modules/retention/application/retention.job.js';
import { TenantPurgeJob } from '../../src/modules/tenant-purge/application/tenant-purge.job.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { bearer, signIn, TEST_PASSWORD } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { pdf, uploadFile } from '../support/file-uploads.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, simpleFlow, TicketWorld } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';
import { readZip, type ZipEntry } from '../support/zip-reader.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
/** Text a spreadsheet would run: the CSV must neutralize it. */
const FORMULA = '=HYPERLINK("http://evil.test","click")';

interface Organization {
  readonly world: TicketWorld;
  readonly adminEmail: string;
  readonly adminId: string;
  readonly requester: Member;
  readonly ticketId: string;
  readonly fileId: string;
  readonly fileContent: Buffer;
  readonly marker: string;
}

interface BuiltExport {
  readonly id: string;
  readonly token: string;
  readonly entries: ZipEntry[];
  readonly bytes: Buffer;
}

/**
 * The whole path of P7 against PostgreSQL and SeaweedFS: request → worker run (real zip, real multipart upload) → READY
 * → ready e-mail → presigned download → the archive opened and checked (content, no secrets, no other tenant), plus the
 * forged e-mail, the expiry step and the purge.
 */
describe('organization data export: the worker builds a real archive', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let worker: MailWorker;
  let storage: ObjectStorage;
  let platformToken: string;
  let a: Organization;
  let b: Organization;
  let exportA: BuiltExport;
  let exportB: BuiltExport;
  const http = () => request(app.getHttpServer());
  const text = (entries: readonly ZipEntry[], name: string) => entries.find((entry) => entry.name === name)?.content.toString('utf8') ?? '';
  const jsonl = (entries: readonly ZipEntry[], dataset: string) => text(entries, `data/${dataset}.jsonl`).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>);
  const exportRow = async (id: string) => (await db.owner.query<{ status: string; storage_key: string | null; storage_deleted_at: Date | null }>('SELECT status, storage_key, storage_deleted_at FROM tenant_data_exports WHERE id = $1', [id])).rows[0];

  async function organization(label: string): Promise<Organization> {
    const world = await TicketWorld.create(db, app);
    const me = (await world.admin.get('/auth/me').expect(200)).body;
    const requester = await world.member([grant('create'), grant('read_created'), grant('comment')]);
    const flow = await publishFlow(world.admin, { ...simpleFlow(), fields: [{ step: 'start', code: 'NOTE', type: 'TEXT', capture: 'CREATION' }] });
    const fileContent = pdf(`${label} contract`);
    const fileId = await uploadFile(requester, { name: `${label} contract.pdf`, content: fileContent });
    const marker = `marker-${label}-${randomUUID()}`;
    const created = await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: `${label} ${marker}`, values: { NOTE: FORMULA }, attachments: [fileId] }).expect(201);
    await requester.client.post(`/tickets/${created.body.id}/comments`, { comment: `Comment of ${label}` }).expect(201);
    return { world, adminEmail: me.user.email, adminId: me.user.id, requester, ticketId: created.body.id, fileId, fileContent, marker };
  }

  /** Secrets that exist in the database for the organization's people: none may reach the archive. */
  async function seedSecrets(org: Organization): Promise<string[]> {
    const tenantId = org.world.tenant.tenantId;
    const secret = `seeded-secret-${randomUUID()}`;
    await db.owner.query(`INSERT INTO webhooks (tenant_id, url, secret_encrypted, events) VALUES ($1, 'https://hooks.test/x', convert_to($2, 'UTF8'), '{ticket.created}')`, [tenantId, `${secret}-webhook`]);
    const backupHash = createHash('sha256').update(secret).digest('hex');
    await db.owner.query(`INSERT INTO user_mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)`, [org.adminId, backupHash]);
    await db.owner.query(`UPDATE users SET mfa_secret_encrypted = convert_to($2, 'UTF8') WHERE id = $1`, [org.requester.userId, `${secret}-mfa`]);
    const { rows } = await db.owner.query<{ value: string }>(
      `SELECT password_hash AS value FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = $1 AND password_hash IS NOT NULL
       UNION ALL SELECT token_hash FROM refresh_sessions r JOIN memberships m ON m.user_id = r.user_id WHERE m.tenant_id = $1
       UNION ALL SELECT token_hash FROM user_tokens t JOIN memberships m ON m.user_id = t.user_id WHERE m.tenant_id = $1`,
      [tenantId],
    );
    return [...rows.map((row) => row.value), secret, backupHash];
  }

  async function requestDeletion(org: Organization): Promise<void> {
    const { tenantId } = org.world.tenant;
    const { name } = (await db.owner.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0]!;
    await http().post(`/platform/tenants/${tenantId}/deletion`).set(bearer(platformToken)).send({ confirmName: name, reason: 'Leaving' }).expect(200);
  }

  /** The admin signs in during the deletion period, asks for the export, and the worker builds it; then it is downloaded. */
  async function exportOf(org: Organization): Promise<BuiltExport> {
    const token = (await signIn(app, org.adminEmail, org.world.tenant.tenantId)).accessToken;
    const id = (await http().post('/data-exports').set(bearer(token)).send({ currentPassword: TEST_PASSWORD, includeFiles: true }).expect(202)).body.id as string;
    // Exports other test files left due may be claimed first: run until this one is built.
    for (let run = 0; run < 20 && (await exportRow(id))?.status !== 'READY'; run += 1) await worker.module.get(DataExportJob).runOnce();
    const detail = (await http().get(`/data-exports/${id}`).set(bearer(token)).expect(200)).body;
    expect(detail).toMatchObject({ status: 'READY', errorCode: null });
    const link = (await http().post(`/data-exports/${id}/download-url`).set(bearer(token)).send({ currentPassword: TEST_PASSWORD }).expect(200)).body.url as string;
    const download = await fetch(link);
    expect(download.status).toBe(200);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.length).toBe(detail.sizeBytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(detail.sha256);
    return { id, token, bytes, entries: await readZip(bytes) };
  }

  let secretsA: string[];

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    storage = app.get(ObjectStorage);
    worker = await MailWorker.start();
    // The test drives the job itself: the worker's own timer must not claim the exports in between.
    await worker.module.get(DataExportScheduler).beforeApplicationShutdown();
    platformToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
    a = await organization('alpha');
    b = await organization('beta');
    secretsA = await seedSecrets(a);
    await seedSecrets(b);
    await requestDeletion(a);
    await requestDeletion(b);
    exportA = await exportOf(a);
    exportB = await exportOf(b);
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await db?.close();
  });

  it('opens with LEEME.txt, ends with manifest.json, and the manifest counts what the archive holds', () => {
    const names = exportA.entries.map((entry) => entry.name);
    expect(names[0]).toBe('LEEME.txt');
    expect(names.at(-1)).toBe('manifest.json');
    const manifest = JSON.parse(text(exportA.entries, 'manifest.json'));
    expect(manifest).toMatchObject({ formatVersion: 1, exportId: exportA.id, includeFiles: true, tenant: { id: a.world.tenant.tenantId }, files: 1, missingFiles: [] });
    for (const dataset of EXPORT_DATASETS) expect(jsonl(exportA.entries, dataset.name), dataset.name).toHaveLength(manifest.datasets[dataset.name]);
    expect(manifest.datasets).toMatchObject({ tickets: 1, tenants: 1 });
    expect(text(exportA.entries, 'LEEME.txt')).toContain('Exportación de datos de');
  });

  it('holds the ticket, its events (with the comment) and its field values, in JSONL and in CSV', () => {
    const [ticket] = jsonl(exportA.entries, 'tickets');
    expect(ticket).toMatchObject({ id: a.ticketId, title: `alpha ${a.marker}`, status: 'OPEN' });
    const events = jsonl(exportA.entries, 'ticket_events').filter((event) => event.ticket_id === a.ticketId);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['CREATED', 'COMMENTED']));
    expect(JSON.stringify(events)).toContain('Comment of alpha');
    expect(jsonl(exportA.entries, 'ticket_field_values').map((value) => value.value)).toContain(FORMULA);
    const csv = text(exportA.entries, 'csv/ticket_field_values.csv');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    expect(text(exportA.entries, 'csv/tickets.csv')).toContain(a.ticketId);
  });

  it('copies the files byte for byte under files/<id>/<name>, and indexes them', () => {
    const path = `files/${a.fileId}/alpha contract.pdf`;
    expect(exportA.entries.find((entry) => entry.name === path)?.content.equals(a.fileContent)).toBe(true);
    const index = text(exportA.entries, 'files/index.csv');
    expect(index).toContain(`${a.fileId},${path}`);
    expect(index).toContain(a.ticketId);
  });

  it('lists the members with only what the organization knows of them', () => {
    const members = jsonl(exportA.entries, 'members');
    expect(members.map((member) => member.user_id)).toEqual(expect.arrayContaining([a.adminId, a.requester.userId]));
    const declared = EXPORT_DATASETS.find((dataset) => dataset.name === 'members')!.columns;
    for (const member of members) expect(Object.keys(member)).toEqual([...declared]);
  });

  it('carries no secret anywhere: no password or token hash, backup code, MFA or webhook secret, nor their column names', () => {
    const everything = Buffer.concat(exportA.entries.map((entry) => entry.content)).toString('utf8');
    for (const secret of secretsA) expect(everything.includes(secret), 'a seeded secret').toBe(false);
    expect(everything).not.toMatch(/\$argon2|password_hash|token_hash|code_hash|secret_encrypted|mfa_secret/);
  });

  it('carries no row of another organization (tenant leak)', () => {
    const tenantA = a.world.tenant.tenantId;
    for (const dataset of EXPORT_DATASETS) {
      const column = dataset.name === 'tenants' ? 'id' : 'tenant_id';
      expect(jsonl(exportA.entries, dataset.name).every((row) => row[column] === tenantA), dataset.name).toBe(true);
    }
    const everything = Buffer.concat(exportA.entries.map((entry) => entry.content)).toString('utf8');
    for (const foreign of [b.world.tenant.tenantId, b.ticketId, b.fileId, b.adminId, b.requester.userId, b.marker]) expect(everything.includes(foreign), foreign).toBe(false);
    expect(Buffer.concat(exportB.entries.map((entry) => entry.content)).toString('utf8').includes(a.marker)).toBe(false);
    // Each export only through its own organization.
    return http().post(`/data-exports/${exportA.id}/download-url`).set(bearer(exportB.token)).send({ currentPassword: TEST_PASSWORD }).expect(404);
  });

  it('stays consistent when the organization changes during the export: audit rows added and deleted mid-way, still READY', async () => {
    const c = await organization('gamma');
    await requestDeletion(c);
    const tenantId = c.world.tenant.tenantId;
    const repository = worker.module.get(ExportDataRepository);
    const original = repository.page.bind(repository);
    let changed = false;
    const spy = vi.spyOn(repository, 'page').mockImplementation(async (tx, pageTenant, dataset, after, limit) => {
      if (pageTenant === tenantId && dataset === 'tickets' && !changed) {
        changed = true;
        // What happens in real life while an export runs: a download link adds an audit row, the retention deletes old ones.
        await db.owner.query(`INSERT INTO audit_logs (tenant_id, action, entity_type) VALUES ($1, 'data_export.download_url_issued', 'DataExport')`, [tenantId]);
        await db.owner.query(`DELETE FROM audit_logs WHERE tenant_id = $1 AND id = (SELECT id FROM audit_logs WHERE tenant_id = $1 ORDER BY id LIMIT 1)`, [tenantId]);
      }
      return original(tx, pageTenant, dataset, after, limit);
    });
    try {
      const built = await exportOf(c);
      expect(changed).toBe(true);
      const manifest = JSON.parse(text(built.entries, 'manifest.json'));
      expect(manifest.datasets.audit_logs).toBe(jsonl(built.entries, 'audit_logs').length);
      expect(manifest.csv.audit_logs).toBe(text(built.entries, 'csv/audit_logs.csv').split('\r\n').filter((line) => line !== '').length - 1);
    } finally {
      spy.mockRestore();
    }
  });

  it('mails the member who asked, with a link to the app page and none to the archive', async () => {
    const mail = await worker.waitForMail(a.adminEmail);
    expect(mail.subject).toBe('La exportación de datos de tu organización está lista');
    expect(mail.text).toContain(`/data-exports?tenant=${a.world.tenant.tenantId}`);
    expect(`${mail.text}${mail.html}`).not.toMatch(/\.zip|tenants\/|X-Amz/i);
  });

  it('sends nothing for a forged ready event (app_platform can queue one): the worker checks it against the database', async () => {
    const forged = [
      [a.world.tenant.tenantId, exportA.id, a.requester.userId],
      [a.world.tenant.tenantId, randomUUID(), a.adminId],
      [b.world.tenant.tenantId, exportA.id, a.adminId],
    ];
    const ids: string[] = [];
    for (const [tenantId, exportId, userId] of forged) {
      await db.platform.query('SELECT enqueue_data_export_ready($1, $2, $3)', [tenantId, exportId, userId]);
      ids.push((await db.owner.query<{ id: string }>(`SELECT id FROM platform_outbox_events WHERE type = 'email.data_export_ready' AND payload ->> 'exportId' = $1 AND payload ->> 'userId' = $2 ORDER BY created_at DESC LIMIT 1`, [exportId, userId])).rows[0]!.id);
    }
    const before = worker.mailer.to(a.adminEmail).length;
    const requesterEmail = (await db.owner.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [a.requester.userId])).rows[0]!.email;
    await worker.deliver();
    expect(worker.mailer.to(requesterEmail)).toEqual([]);
    expect(worker.mailer.to(a.adminEmail)).toHaveLength(before);
    const { rows } = await db.owner.query<{ status: string }>('SELECT status FROM platform_outbox_events WHERE id = ANY($1::uuid[])', [ids]);
    expect(rows.map((row) => row.status)).toEqual(['DONE', 'DONE', 'DONE']);
  });

  it('shows the export state to platform operations, without its content', async () => {
    const detail = (await http().get(`/platform/tenants/${a.world.tenant.tenantId}`).set(bearer(platformToken)).expect(200)).body;
    expect(detail.dataExport).toEqual({ status: 'READY', errorCode: null });
  });

  it('the nightly retention expires it and deletes the archive', async () => {
    const key = (await exportRow(exportA.id))!.storage_key!;
    expect(await storage.head(key)).not.toBeNull();
    await db.owner.query(`UPDATE tenant_data_exports SET expires_at = now() - interval '1 second' WHERE id = $1`, [exportA.id]);
    const summary = await worker.module.get(RetentionJob).runOnce();
    try {
      expect(summary).toBeDefined();
      expect(summary!.failed).not.toContain('expire_tenant_exports');
      expect(await exportRow(exportA.id)).toMatchObject({ status: 'EXPIRED', storage_deleted_at: expect.any(Date) });
      expect(await storage.head(key)).toBeNull();
      await http().post(`/data-exports/${exportA.id}/download-url`).set(bearer(exportA.token)).send({ currentPassword: TEST_PASSWORD }).expect(410);
    } finally {
      // One run per 20 hours: leave the trail as other files expect it.
      if (summary) await db.owner.query(`DELETE FROM platform_audit_logs WHERE id = $1 OR (action = 'retention.run_finished' AND data ->> 'runId' = $1::text)`, [summary.runId]);
    }
  });

  it('the purge removes the archive with the rest of the organization', async () => {
    const tenantId = b.world.tenant.tenantId;
    const key = (await exportRow(exportB.id))!.storage_key!;
    expect(await storage.head(key)).not.toBeNull();
    await db.owner.query(`UPDATE tenants SET purge_after = now() - interval '1 minute' WHERE id = $1`, [tenantId]);
    const status = async () => (await db.owner.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId])).rows[0]!.status;
    for (let run = 0; run < 10 && (await status()) !== 'PURGED'; run += 1) await worker.module.get(TenantPurgeJob).runOnce();
    expect(await status()).toBe('PURGED');
    expect(await storage.head(key)).toBeNull();
    expect(await exportRow(exportB.id)).toBeUndefined();
  });
});
