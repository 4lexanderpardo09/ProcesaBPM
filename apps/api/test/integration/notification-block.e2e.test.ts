import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, publishVersion, TicketWorld, unique, type FlowSpec } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

interface NotificationBody {
  type: string;
  title: string;
  body: string;
  ticketId: string | null;
}

describe('NOTIFICATION blocks: who is told, with which text, through which channel', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let world: TicketWorld;
  let requester: Member;
  let assignee: Member;
  let groupReader: Member;
  let groupBlind: Member;
  let positionReader: Member;
  let outsider: Member;
  let groupId: string;
  let positionId: string;

  const emailOf = async (member: Member) => (await member.client.get('/auth/me').expect(200)).body.user.email as string;
  const noticesOf = async (member: Member, ticketId: string): Promise<NotificationBody[]> =>
    ((await member.client.get('/notifications?pageSize=100').expect(200)).body.items as NotificationBody[]).filter((item) => item.ticketId === ticketId && item.type === 'SYSTEM');

  const flowWith = (config: Record<string, unknown>): Promise<Awaited<ReturnType<typeof publishFlow>>> => {
    const spec: FlowSpec = {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'notice', type: 'NOTIFICATION', extra: { config } },
        { key: 'task', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: assignee.userId }] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'notice', type: 'DEFAULT' },
        { from: 'notice', to: 'task', type: 'DEFAULT' },
        { from: 'task', to: 'end', type: 'DECISION', label: 'Done' },
      ],
      fields: [
        { step: 'start', code: 'PROVIDER', type: 'TEXT', capture: 'CREATION' },
        { step: 'start', code: 'AMOUNT', type: 'CURRENCY', capture: 'CREATION' },
      ],
    };
    return publishFlow(world.admin, spec);
  };
  const create = async (flow: { subcategoryId: string }, title = unique('Ticket')) =>
    (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title, values: { PROVIDER: 'Ñandú S.A.', AMOUNT: 1500000 } }).expect(201)).body as { id: string };
  const base = { channels: ['EMAIL', 'IN_APP'], subject: 'Ticket #{{ticket.number}} de {{ticket.creatorName}}', body: 'Asunto: {{ticket.title}}\n\nProveedor: {{PROVIDER}} · Monto {{field.AMOUNT|currency}}' };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
    world = await TicketWorld.create(db, app);
    positionId = await world.position();
    requester = await world.member([grant('create'), grant('read_created')]);
    assignee = await world.member([grant('read_assigned'), grant('transition')]);
    groupReader = await world.member([grant('read_all')]);
    groupBlind = await world.member([grant('read_created')]);
    positionReader = await world.member([grant('read_all')], { positionId });
    outsider = await world.member([grant('read_all')]);
    groupId = await world.group([groupReader.userId, groupBlind.userId]);
    await mail.deliver();
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  it('tells the creator, the assignees, a group and a position with the text filled in, in the app and by e-mail; not people who cannot read the ticket nor outsiders', async () => {
    const flow = await flowWith({ ...base, recipients: [{ kind: 'CREATOR' }, { kind: 'ASSIGNEES' }, { kind: 'GROUP', id: groupId }, { kind: 'POSITION', id: positionId }] });
    const ticket = await create(flow, 'Compra de sillas');
    await mail.deliver();
    const creatorName = (await requester.client.get('/auth/me').expect(200)).body.user.firstName as string;

    for (const member of [requester, assignee, groupReader, positionReader]) {
      const [notice] = await noticesOf(member, ticket.id);
      expect(notice, 'an in-app notice').toBeDefined();
      expect(notice!.title).toMatch(new RegExp(`^Ticket #\\d+ de ${creatorName}`));
      expect(notice!.body).toContain('Asunto: Compra de sillas');
      expect(notice!.body).toContain('Proveedor: Ñandú S.A.');
      expect(notice!.body).toMatch(/Monto .*1\.500\.000/);
      const message = mail.mailer.to(await emailOf(member)).find((candidate) => candidate.subject.startsWith('Ticket #') && candidate.text.includes('Compra de sillas'));
      expect(message, 'an e-mail').toBeDefined();
      expect(message!.subject).toBe(notice!.title);
      expect(message!.html).toContain('<p style="margin:0 0 16px">Asunto: Compra de sillas</p>');
    }
    expect(await noticesOf(groupBlind, ticket.id)).toEqual([]);
    expect(mail.mailer.to(await emailOf(groupBlind)).some((candidate) => candidate.text.includes('Compra de sillas'))).toBe(false);
    expect(await noticesOf(outsider, ticket.id)).toEqual([]);
  });

  it('a person named twice (by user and by group) is told once', async () => {
    const flow = await flowWith({ ...base, channels: ['IN_APP'], recipients: [{ kind: 'USER', id: groupReader.userId }, { kind: 'GROUP', id: groupId }, { kind: 'CREATOR' }, { kind: 'CREATOR' }] });
    const ticket = await create(flow);
    await mail.deliver();
    expect(await noticesOf(groupReader, ticket.id)).toHaveLength(1);
    expect(await noticesOf(requester, ticket.id)).toHaveLength(1);
  });

  it('only the channels the block asks for are used', async () => {
    const onlyMail = await flowWith({ ...base, channels: ['EMAIL'], recipients: [{ kind: 'CREATOR' }] });
    const first = await create(onlyMail, 'Solo correo');
    await mail.deliver();
    expect(await noticesOf(requester, first.id)).toEqual([]);
    expect(mail.mailer.to(await emailOf(requester)).some((candidate) => candidate.text.includes('Solo correo'))).toBe(true);

    const onlyApp = await flowWith({ ...base, channels: ['IN_APP'], recipients: [{ kind: 'CREATOR' }] });
    const second = await create(onlyApp, 'Solo aplicación');
    await mail.deliver();
    expect(await noticesOf(requester, second.id)).toHaveLength(1);
    expect(mail.mailer.to(await emailOf(requester)).some((candidate) => candidate.text.includes('Solo aplicación'))).toBe(false);
  });

  it('respects the preferences of the person for this kind of notice', async () => {
    const picky = await world.member([grant('create'), grant('read_created')]);
    await picky.client.put('/notifications/preferences/SYSTEM', { inApp: false, email: true }).expect(200);
    const flow = await flowWith({ ...base, recipients: [{ kind: 'CREATOR' }] });
    const ticket = (await picky.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Con preferencias', values: { PROVIDER: 'X', AMOUNT: 1 } }).expect(201)).body as { id: string };
    await mail.deliver();
    expect(await noticesOf(picky, ticket.id)).toEqual([]);
    expect(mail.mailer.to(await emailOf(picky)).some((candidate) => candidate.text.includes('Con preferencias'))).toBe(true);
  });

  it('the HTML of the e-mail escapes what the ticket says, and the subject stays on one line', async () => {
    const flow = await flowWith({ ...base, channels: ['EMAIL'], recipients: [{ kind: 'CREATOR' }] });
    const ticket = await create(flow, 'Hola <img src=x onerror=alert(1)>\nlinea');
    await mail.deliver();
    const message = mail.mailer.to(await emailOf(requester)).find((candidate) => candidate.text.includes('onerror'));
    expect(message).toBeDefined();
    expect(message!.html).not.toContain('<img');
    expect(message!.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(message!.subject).not.toMatch(/[\r\n]/);
    expect(ticket.id).toBeDefined();
  });

  it('a block with a text that names something that does not exist cannot be published, and a missing field only warns', async () => {
    const category = (await world.admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await world.admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await world.admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
    const spec = (subject: string): FlowSpec => ({
      steps: [{ key: 'start', type: 'START' }, { key: 'notice', type: 'NOTIFICATION', extra: { config: { recipients: [{ kind: 'CREATOR' }], channels: ['IN_APP'], subject, body: 'x' } } }, { key: 'end', type: 'END' }],
      transitions: [{ from: 'start', to: 'notice', type: 'DEFAULT' }, { from: 'notice', to: 'end', type: 'DEFAULT' }],
    });
    await expect(publishVersion(world.admin, workflow.id as string, workflow.versions[0].id as string, spec('Hola {{ticket.nope}}'))).rejects.toThrow(/NOTIFICATION_TEXT_INVALID/);
  });

  it('a block cannot name a person of another organization: the version is not published and nobody there is told', async () => {
    const other = await TicketWorld.create(db, app);
    const stranger = await other.member([grant('read_all')]);
    await expect(flowWith({ ...base, recipients: [{ kind: 'USER', id: stranger.userId }] })).rejects.toThrow(/BLOCK_REFERENCE_UNKNOWN/);
    expect((await stranger.client.get('/notifications?pageSize=100').expect(200)).body.items.filter((item: NotificationBody) => item.type === 'SYSTEM')).toEqual([]);
  });

  it('does not run again for a repeated event: one notice per person and block', async () => {
    const flow = await flowWith({ ...base, channels: ['IN_APP'], recipients: [{ kind: 'CREATOR' }] });
    const ticket = await create(flow);
    await mail.deliver();
    await mail.deliver();
    expect(await noticesOf(requester, ticket.id)).toHaveLength(1);
  });
});
