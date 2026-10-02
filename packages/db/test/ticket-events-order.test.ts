import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, sqlStateOf, type TestDatabase } from './support/database.js';
import { seedTenant, seedTicket, type SeededTenant, type SeededTicket } from './support/fixtures.js';

describe('the timeline of a ticket has a total order of its own', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let ticket: SeededTicket;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    ticket = await seedTicket(db.platform, tenant);
  });
  afterAll(async () => {
    await db.close();
  });

  const insert = async (label: string, createdAt: string) =>
    (await db.platform.query<{ seq: string }>(`INSERT INTO ticket_events (tenant_id, ticket_id, type, loop, created_at, data) VALUES ($1, $2, 'SYSTEM', 1, $3, $4::jsonb) RETURNING seq::text`, [tenant.tenantId, ticket.ticketId, createdAt, JSON.stringify({ label })])).rows[0]!.seq;

  it('is assigned by the database in insertion order, even when the clock stepped back', async () => {
    const first = BigInt(await insert('first', '2026-10-02T10:00:00Z'));
    const second = BigInt(await insert('second', '2026-10-02T09:59:59Z'));
    expect(second).toBeGreaterThan(first);
    const ordered = await db.platform.query<{ label: string }>(`SELECT data ->> 'label' AS label FROM ticket_events WHERE ticket_id = $1 AND data ? 'label' ORDER BY seq`, [ticket.ticketId]);
    expect(ordered.rows.map((row) => row.label)).toEqual(['first', 'second']);
  });

  it('cannot be chosen by the writer', async () => {
    const choose = () => db.platform.query(`INSERT INTO ticket_events (tenant_id, ticket_id, type, loop, seq) VALUES ($1, $2, 'SYSTEM', 1, 1)`, [tenant.tenantId, ticket.ticketId]);
    expect(await sqlStateOf(choose)).toBe('428C9');
  });

  it('the API role inserts events without any privilege on a sequence', async () => {
    const { rows } = await db.owner.query<{ allowed: boolean }>(`SELECT has_table_privilege('app_runtime', 'ticket_events', 'INSERT') AS allowed`);
    expect(rows[0]?.allowed).toBe(true);
  });
});
