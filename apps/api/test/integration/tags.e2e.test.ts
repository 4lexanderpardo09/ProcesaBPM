import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('personal tags', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let member: Member; // create + read_created
  let other: Member; // create + read_created
  let ticketId: string;

  const createTicket = async (as: Member, subcategoryId: string) => (await as.client.post('/tickets', { subcategoryId, title: unique('Ticket'), values: {} }).expect(201)).body.id as string;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    member = await world.member([grant('create'), grant('read_created')]);
    other = await world.member([grant('create'), grant('read_created')]);
    const flow = await publishFlow(world.admin, simpleFlow());
    ticketId = await createTicket(member, flow.subcategoryId);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const newTag = (as: Member, name = unique('tag'), color = '#4F46E5') => as.client.post('/tags', { name, color }).expect(201);

  describe('CRUD', () => {
    it('creates, lists and edits my own tags', async () => {
      const tag = (await newTag(member)).body;
      expect(tag).toMatchObject({ name: expect.any(String), color: '#4F46E5' });
      expect((await member.client.get('/tags').expect(200)).body).toEqual(expect.arrayContaining([tag]));

      const renamed = (await member.client.patch(`/tags/${tag.id}`, { name: 'renamed', color: '#BE123C' }).expect(200)).body;
      expect(renamed).toMatchObject({ id: tag.id, name: 'renamed', color: '#BE123C' });

      await member.client.delete(`/tags/${tag.id}`).expect(204);
      expect((await member.client.get('/tags').expect(200)).body).not.toEqual(expect.arrayContaining([{ id: tag.id }]));
    });

    it('rejects a repeated name', async () => {
      const name = unique('dup');
      await newTag(member, name);
      await member.client.post('/tags', { name, color: '#4F46E5' }).expect(409);
    });

    it('validates name and colour', async () => {
      await member.client.post('/tags', { name: '', color: '#4F46E5' }).expect(400);
      await member.client.post('/tags', { name: unique('x'), color: 'blue' }).expect(400);
    });

    it("one member never sees or touches another's tags", async () => {
      const mine = (await newTag(member)).body;
      expect((await other.client.get('/tags').expect(200)).body).not.toEqual(expect.arrayContaining([{ id: mine.id }]));
      await other.client.patch(`/tags/${mine.id}`, { name: 'stolen' }).expect(404);
      await other.client.delete(`/tags/${mine.id}`).expect(404);
    });
  });

  describe('on a ticket', () => {
    it('attaches, lists and detaches my tag, and the ticket detail carries it', async () => {
      const tag = (await newTag(member)).body;
      await member.client.post(`/tickets/${ticketId}/tags`, { tagId: tag.id }).expect(201);
      // Idempotent.
      await member.client.post(`/tickets/${ticketId}/tags`, { tagId: tag.id }).expect(201);
      expect((await member.client.get(`/tickets/${ticketId}/tags`).expect(200)).body).toEqual([tag]);

      const detail = (await member.client.get(`/tickets/${ticketId}`).expect(200)).body;
      expect(detail.tags).toEqual([tag]);

      await member.client.delete(`/tickets/${ticketId}/tags/${tag.id}`).expect(204);
      expect((await member.client.get(`/tickets/${ticketId}/tags`).expect(200)).body).toEqual([]);
    });

    it("cannot attach another member's tag", async () => {
      const mine = (await newTag(member)).body;
      await other.client.post(`/tickets/${ticketId}/tags`, { tagId: mine.id }).expect(404);
    });

    it('cannot tag a ticket it cannot read', async () => {
      const foreign = await world.member([grant('create'), grant('read_assigned')]);
      const tag = (await newTag(foreign)).body;
      // Its own ticket is unreadable to `member` (read_created only), and vice versa.
      const otherTicket = await createTicket(foreign, (await publishFlow(world.admin, simpleFlow())).subcategoryId);
      await member.client.post(`/tickets/${otherTicket}/tags`, { tagId: tag.id }).expect(404);
      await member.client.get(`/tickets/${otherTicket}/tags`).expect(404);
    });
  });
});
