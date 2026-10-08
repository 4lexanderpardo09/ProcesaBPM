import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

describe('text templates', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let owner: Member;
  let other: Member;
  let ownerName: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    owner = await world.member([]);
    other = await world.member([]);
    const me = (await owner.client.get('/auth/me').expect(200)).body.user as { firstName: string; lastName: string };
    ownerName = `${me.firstName} ${me.lastName}`.trim();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const create = async (as: Member, title = unique('tpl')) => (await as.client.post('/text-templates', { title, bodyHtml: '<p>Hola</p>' }).expect(201)).body;

  it('creates, lists, reads and edits my own template', async () => {
    const tpl = await create(owner);
    expect(tpl).toMatchObject({ isOwner: true, ownerId: owner.userId, ownerName, bodyHtml: '<p>Hola</p>' });
    expect((await owner.client.get('/text-templates').expect(200)).body).toEqual(expect.arrayContaining([tpl]));
    expect((await owner.client.get(`/text-templates/${tpl.id}`).expect(200)).body).toEqual(tpl);
    const edited = (await owner.client.patch(`/text-templates/${tpl.id}`, { title: 'Nuevo' }).expect(200)).body;
    expect(edited).toMatchObject({ id: tpl.id, title: 'Nuevo' });
  });

  it('validates the title and the body', async () => {
    await owner.client.post('/text-templates', { title: '', bodyHtml: '<p>x</p>' }).expect(400);
    await owner.client.post('/text-templates', { title: unique('t'), bodyHtml: '' }).expect(400);
  });

  it('sanitizes the stored HTML', async () => {
    const tpl = (await owner.client.post('/text-templates', { title: unique('xss'), bodyHtml: '<p>ok</p><script>alert(1)</script>' }).expect(201)).body;
    expect(tpl.bodyHtml).not.toContain('<script>');
    expect(tpl.bodyHtml).toContain('ok');
  });

  it('another member cannot see or touch a template that is not shared', async () => {
    const tpl = await create(owner);
    expect((await other.client.get('/text-templates').expect(200)).body).not.toEqual(expect.arrayContaining([{ id: tpl.id }]));
    await other.client.get(`/text-templates/${tpl.id}`).expect(404);
    await other.client.patch(`/text-templates/${tpl.id}`, { title: 'hack' }).expect(404);
    await other.client.delete(`/text-templates/${tpl.id}`).expect(404);
    await other.client.get(`/text-templates/${tpl.id}/shares`).expect(404);
  });

  it('shares read-only: the sharee reads it but cannot edit, delete or manage shares', async () => {
    const tpl = await create(owner);
    expect((await owner.client.get(`/text-templates/${tpl.id}/shares`).expect(200)).body).toEqual([]);
    // The owner is dropped from the list, even when sent.
    expect((await owner.client.put(`/text-templates/${tpl.id}/shares`, { userIds: [other.userId, owner.userId] }).expect(200)).body).toEqual([other.userId]);
    const shared = (await other.client.get(`/text-templates/${tpl.id}`).expect(200)).body;
    expect(shared).toMatchObject({ id: tpl.id, isOwner: false, ownerId: owner.userId, ownerName });
    expect((await other.client.get('/text-templates').expect(200)).body).toEqual(expect.arrayContaining([shared]));
    await other.client.patch(`/text-templates/${tpl.id}`, { title: 'hack' }).expect(404);
    await other.client.delete(`/text-templates/${tpl.id}`).expect(404);
    await other.client.put(`/text-templates/${tpl.id}/shares`, { userIds: [] }).expect(404);
  });

  it('drops a share to someone who is not a member of the tenant', async () => {
    const tpl = await create(owner);
    const stranger = '0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90';
    expect((await owner.client.put(`/text-templates/${tpl.id}/shares`, { userIds: [stranger, other.userId] }).expect(200)).body).toEqual([other.userId]);
  });

  it('deleting removes it for everyone it was shared with', async () => {
    const tpl = await create(owner);
    await owner.client.put(`/text-templates/${tpl.id}/shares`, { userIds: [other.userId] }).expect(200);
    await owner.client.delete(`/text-templates/${tpl.id}`).expect(204);
    await other.client.get(`/text-templates/${tpl.id}`).expect(404);
  });
});
