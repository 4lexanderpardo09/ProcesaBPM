import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { pdf, png, uploadFile } from '../support/file-uploads.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, TicketWorld } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('own profile and signature', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let member: Member;
  let other: Member;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    member = await world.member([grant('create')]);
    other = await world.member([grant('create')]);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('edits my own name, language and time zone', async () => {
    const updated = (await member.client.patch('/auth/me', { firstName: 'Nuevo', lastName: 'Apellido', locale: 'en-US', timeZone: 'America/Bogota' }).expect(200)).body;
    expect(updated.user).toMatchObject({ firstName: 'Nuevo', lastName: 'Apellido', locale: 'en-US', timeZone: 'America/Bogota' });
    expect((await member.client.get('/auth/me').expect(200)).body.user).toMatchObject({ firstName: 'Nuevo', lastName: 'Apellido' });
  });

  it('validates the profile fields', async () => {
    await member.client.patch('/auth/me', {}).expect(400);
    await member.client.patch('/auth/me', { locale: 'spanish' }).expect(400);
    await member.client.patch('/auth/me', { firstName: '' }).expect(400);
  });

  it('sets the signature from my own confirmed image', async () => {
    const fileId = await uploadFile(member, { name: 'firma.png', content: png() });
    await member.client.put('/auth/me/signature', { fileId }).expect(204);
    expect((await member.client.get('/auth/me').expect(200)).body.membership.signatureFileId).toBe(fileId);
    expect((await member.client.get('/auth/me/signature').expect(200)).body).toMatchObject({ url: expect.any(String), expiresAt: expect.any(String) });
  });

  it('refuses a file that is not an image', async () => {
    const fileId = await uploadFile(member, { name: 'doc.pdf', content: pdf() });
    await member.client.put('/auth/me/signature', { fileId }).expect(422);
  });

  it("refuses someone else's file", async () => {
    const fileId = await uploadFile(other, { name: 'firma.png', content: png() });
    await member.client.put('/auth/me/signature', { fileId }).expect(404);
  });

  it('clears the signature', async () => {
    await member.client.delete('/auth/me/signature').expect(204);
    expect((await member.client.get('/auth/me').expect(200)).body.membership.signatureFileId).toBeNull();
    // No signature: an empty body (Nest serializes the null of the contract as `{}`).
    expect((await member.client.get('/auth/me/signature').expect(200)).body).toEqual({});
  });
});
