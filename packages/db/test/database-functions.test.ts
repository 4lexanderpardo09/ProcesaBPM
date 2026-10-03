import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

describe('database functions', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenantA = await seedTenant(db.platform);
    tenantB = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('next_tenant_sequence', () => {
    const nextTicketNumber = (tenantId: string) =>
      withContext(db.runtime, { tenantId }, async (client) => {
        const { rows } = await client.query<{ value: string }>("SELECT next_tenant_sequence('ticket') AS value");
        return Number(rows[0]?.value);
      });

    it('numbers tickets independently for each tenant', async () => {
      expect(await nextTicketNumber(tenantA.tenantId)).toBe(1);
      expect(await nextTicketNumber(tenantA.tenantId)).toBe(2);
      expect(await nextTicketNumber(tenantB.tenantId)).toBe(1);
    });

    it('never hands out the same number to concurrent requests', async () => {
      const numbers = await Promise.all(Array.from({ length: 20 }, () => nextTicketNumber(tenantB.tenantId)));

      expect(new Set(numbers).size).toBe(numbers.length);
    });
  });

  describe('auth entry points', () => {
    it('find a user by e-mail before a tenant is selected, ignoring letter case', async () => {
      const { rows: users } = await db.platform.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
        tenantA.userId,
      ]);
      const email = users[0]?.email.toUpperCase() ?? '';

      const found = await withoutContext(db.runtime, async (client) => {
        const { rows } = await client.query<{ id: string }>('SELECT id FROM auth_find_user_by_email($1)', [email]);
        return rows.map((row) => row.id);
      });

      expect(found).toEqual([tenantA.userId]);
    });

    it('list the tenants of the authenticated user only', async () => {
      const listFor = (userId: string, authenticatedAs: string) =>
        withContext(db.runtime, { userId: authenticatedAs }, async (client) => {
          const { rows } = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM auth_list_memberships($1)', [
            userId,
          ]);
          return rows.map((row) => row.tenant_id);
        });

      expect(await listFor(tenantA.userId, tenantA.userId)).toEqual([tenantA.tenantId]);
      expect(await listFor(tenantA.userId, tenantB.userId)).toEqual([]);
    });
  });

  describe('claim_outbox_events', () => {
    it('lets the worker role claim pending events across tenants without handing the same event to two workers', async () => {
      // Other test files leave events behind; this test counts exactly the ones it creates.
      await db.owner.query(`UPDATE outbox_events SET status = 'DONE', processed_at = now(), claim_token = NULL WHERE status IN ('PENDING', 'PROCESSING')`);
      for (const { tenantId } of [tenantA, tenantB]) {
        await db.platform.query(
          `INSERT INTO outbox_events (tenant_id, type, payload)
           SELECT $1, 'ticket.created', '{}'::jsonb FROM generate_series(1, 5)`,
          [tenantId],
        );
      }

      const claimBatch = () =>
        withoutContext(db.worker, async (client) => {
          const { rows } = await client.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM claim_outbox_events(4, NULL::text[])');
          return rows;
        });
      const batches = await Promise.all([claimBatch(), claimBatch(), claimBatch()]);

      const claimedIds = batches.flat().map((row) => row.id);
      expect(claimedIds).toHaveLength(10);
      expect(new Set(claimedIds).size).toBe(10);
      expect(new Set(batches.flat().map((row) => row.tenant_id))).toEqual(new Set([tenantA.tenantId, tenantB.tenantId]));
    });
  });
});
