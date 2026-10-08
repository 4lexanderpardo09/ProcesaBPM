import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('dashboard', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let member: Member;
  let other: Member;
  let ticketId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    member = await world.member([grant('create'), grant('read_created')]);
    other = await world.member([grant('create'), grant('read_created')]);
    const flow = await publishFlow(world.admin, simpleFlow());
    // The simple flow's TASK step is handled by the creator, so the ticket is assigned to them.
    ticketId = (await member.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Ticket'), values: {} }).expect(201)).body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('counts my own open tickets and what I created', async () => {
    expect((await member.client.get('/dashboard/stats').expect(200)).body).toMatchObject({ myOpen: 1, createdByMeOpen: 1, myOverdue: 0, myDueSoon: 0, closedByMeWeek: 0 });
  });

  it('lists the tickets waiting on me', async () => {
    const pending = (await member.client.get('/dashboard/pending').expect(200)).body as Array<{ id: string; status: string; overdue: boolean; dueAt: string | null }>;
    expect(pending.find((ticket) => ticket.id === ticketId)).toMatchObject({ status: 'OPEN', overdue: false, dueAt: null });
  });

  it('never counts another member tickets', async () => {
    expect((await other.client.get('/dashboard/stats').expect(200)).body).toMatchObject({ myOpen: 0, createdByMeOpen: 0 });
    expect((await other.client.get('/dashboard/pending').expect(200)).body).toEqual([]);
  });
});
