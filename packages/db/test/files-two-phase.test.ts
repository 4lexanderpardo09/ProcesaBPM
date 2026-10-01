import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { seedTenant, seedTicket, withPlatformTransaction, type SeededTenant, type SeededTicket } from './support/fixtures.js';

const SHA256 = 'a'.repeat(64);

describe('two-phase file upload rules', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;
  let ticket: SeededTicket;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenant, other] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    ticket = await seedTicket(db.platform, tenant);
  });
  afterAll(async () => {
    await db.close();
  });

  const keyFor = (tenantId: string, id: string) => `tenants/${tenantId}/2026/10/${id}`;

  const insertFile = async (status: 'PENDING' | 'CONFIRMED' = 'PENDING', owner: SeededTenant = tenant) => {
    const id = randomUUID();
    await db.platform.query(
      `INSERT INTO stored_files (tenant_id, id, storage_key, original_name, mime_type, size_bytes, sha256, origin, status, confirmed_at, uploaded_by_id)
       VALUES ($1, $2, $3, 'a.pdf', 'application/pdf', 10, $4, 'USER', $5::file_status, CASE WHEN $5 = 'CONFIRMED' THEN now() END, $6)`,
      [owner.tenantId, id, keyFor(owner.tenantId, id), SHA256, status, owner.userId],
    );
    return id;
  };
  const attach = (fileId: string, role = 'ATTACHMENT') =>
    db.platform.query(`INSERT INTO ticket_documents (tenant_id, ticket_id, file_id, role) VALUES ($1, $2, $3, $4::ticket_document_role)`, [
      tenant.tenantId,
      ticket.ticketId,
      fileId,
      role,
    ]);

  describe('storage key and lifecycle checks', () => {
    it('reject a key that does not match the row or points at another tenant', async () => {
      const id = randomUUID();
      const insertWithKey = (key: string) =>
        db.platform.query(
          `INSERT INTO stored_files (tenant_id, id, storage_key, original_name, mime_type, size_bytes, sha256, origin)
           VALUES ($1, $2, $3, 'a.pdf', 'application/pdf', 1, $4, 'USER')`,
          [tenant.tenantId, id, key, SHA256],
        );
      expect(await sqlStateOf(() => insertWithKey(keyFor(other.tenantId, id)))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => insertWithKey(keyFor(tenant.tenantId, randomUUID())))).toBe(SqlState.checkViolation);
      await expect(insertWithKey(keyFor(tenant.tenantId, id))).resolves.toBeDefined();
    });

    it('reject a PENDING file that is already confirmed, linked or deleted', async () => {
      const id = await insertFile();
      for (const set of ['confirmed_at = now()', 'linked_at = now()', 'deleted_at = now()']) {
        expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET ${set} WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.checkViolation);
      }
    });

    it('reject a CONFIRMED file without confirmation date and a DELETED one without deletion date', async () => {
      const id = await insertFile();
      expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET status = 'CONFIRMED' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.checkViolation);
      const confirmed = await insertFile('CONFIRMED');
      expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET status = 'DELETED' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, confirmed]))).toBe(SqlState.checkViolation);
    });
  });

  describe('immutability guard', () => {
    it('confirms a pending upload, then freezes its content', async () => {
      const id = await insertFile();
      await db.platform.query(`UPDATE stored_files SET status = 'CONFIRMED', confirmed_at = now(), mime_type = 'application/zip' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]);
      for (const set of ["size_bytes = 11", `sha256 = '${'b'.repeat(64)}'`, "mime_type = 'image/png'", "original_name = 'b.pdf'"]) {
        expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET ${set} WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.restrictViolation);
      }
    });

    it('never changes identity columns and never goes back to PENDING', async () => {
      const id = await insertFile('CONFIRMED');
      expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET origin = 'SYSTEM' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET uploaded_by_id = NULL WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET status = 'PENDING', confirmed_at = NULL WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.restrictViolation);
    });

    it('links a file once', async () => {
      const id = await insertFile('CONFIRMED');
      await db.platform.query(`UPDATE stored_files SET linked_at = now(), company_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id, tenant.companyId]);
      expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET linked_at = now() WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(() => db.platform.query(`UPDATE stored_files SET company_id = NULL WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]))).toBe(SqlState.restrictViolation);
    });

    it('lets only abandoned uploads be deleted', async () => {
      const abandoned = await insertFile();
      await expect(db.platform.query(`DELETE FROM stored_files WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, abandoned])).resolves.toBeDefined();

      const linked = await insertFile('CONFIRMED');
      await db.platform.query(`UPDATE stored_files SET linked_at = now() WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, linked]);
      expect(await sqlStateOf(() => db.platform.query(`DELETE FROM stored_files WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, linked]))).toBe(SqlState.restrictViolation);

      const deleted = await insertFile('CONFIRMED');
      await db.platform.query(`UPDATE stored_files SET status = 'DELETED', deleted_at = now() WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, deleted]);
      expect(await sqlStateOf(() => db.platform.query(`DELETE FROM stored_files WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, deleted]))).toBe(SqlState.restrictViolation);
    });

    it('lets the tenant purge remove a linked file', async () => {
      const id = await insertFile('CONFIRMED');
      await db.platform.query(`UPDATE stored_files SET linked_at = now() WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]);
      await withPlatformTransaction(db.platform, async (tx) => {
        await tx.query(`SELECT set_config('app.purge_tenant', $1, true)`, [tenant.tenantId]);
        await tx.query(`DELETE FROM stored_files WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]);
      });
      expect((await db.platform.query('SELECT 1 FROM stored_files WHERE id = $1', [id])).rowCount).toBe(0);
    });
  });

  describe('ticket attachments', () => {
    it('only attach confirmed files', async () => {
      expect(await sqlStateOf(async () => attach(await insertFile('PENDING')))).toBe(SqlState.checkViolation);
      await expect(attach(await insertFile('CONFIRMED'))).resolves.toBeDefined();
    });

    it('attach a user upload once', async () => {
      const id = await insertFile('CONFIRMED');
      await attach(id);
      expect(await sqlStateOf(() => attach(id))).toBe(SqlState.uniqueViolation);
    });
  });

  describe('find_tenants_with_stale_uploads', () => {
    const find = (cutoff: Date) =>
      withoutContext(db.worker, async (client) => (await client.query<{ out_tenant_id: string }>('SELECT * FROM find_tenants_with_stale_uploads($1, 100)', [cutoff])).rows.map((row) => row.out_tenant_id));

    it('returns the tenants with unlinked uploads older than the cutoff, and nothing else', async () => {
      const lonely = await seedTenant(db.platform);
      const id = await insertFile('PENDING', lonely);
      expect(await find(new Date(Date.now() - 3_600_000))).not.toContain(lonely.tenantId);
      expect(await find(new Date(Date.now() + 3_600_000))).toContain(lonely.tenantId);

      await db.platform.query(`UPDATE stored_files SET status = 'CONFIRMED', confirmed_at = now(), linked_at = now() WHERE tenant_id = $1 AND id = $2`, [lonely.tenantId, id]);
      expect(await find(new Date(Date.now() + 3_600_000))).not.toContain(lonely.tenantId);
    });

    it('is callable by the worker only', async () => {
      const asRuntime = () => withoutContext(db.runtime, (client) => client.query('SELECT * FROM find_tenants_with_stale_uploads(now(), 10)'));
      expect(await sqlStateOf(asRuntime)).toBe(SqlState.insufficientPrivilege);
    });
  });

});
