import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, type PublishedFlow, publishFlow, REQUESTER_GRANTS, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

describe('GET /fields/:fieldId/options', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let filler: Member;
  let flow: PublishedFlow;
  let cashier: string;
  let teller: Member;
  let cashierOff: Member;
  let auditor: Member;
  const branch = unique('Branch');
  const fields: Record<string, string> = {};

  const options = (code: string, query: Record<string, string> = {}) => filler.client.get(`/fields/${fields[code]}/options`).query(query);
  const name = (member: Member, first: string, last: string) => db.platform.query('UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1', [member.userId, first, last]);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    filler = await world.member(REQUESTER_GRANTS);
    cashier = await world.position(unique('Cashier'));
    teller = await world.member([], { positionId: cashier });
    cashierOff = await world.member([], { positionId: cashier });
    auditor = await world.member([]);
    await name(teller, 'Zoe', 'Caja Uno');
    await name(cashierOff, 'Zack', 'Caja Dos');
    await name(auditor, 'Zelda', 'Auditora');
    await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, cashierOff.userId]);

    const root = (await world.admin.post('/sites', { name: branch }).expect(201)).body.id as string;
    await world.admin.post('/sites', { name: `${branch} Norte 100%`, parentId: root }).expect(201);
    await world.admin.post('/sites', { name: `${branch} Sur`, parentId: root }).expect(201);

    flow = await publishFlow(world.admin, {
      ...simpleFlow(),
      fields: [
        { step: 'start', code: 'CASHIER', type: 'USER', capture: 'CREATION', config: { positionIds: [cashier] } },
        { step: 'start', code: 'ANYONE', type: 'MULTI_SELECT', capture: 'CREATION', dataSource: { kind: 'PRESET', preset: 'USERS' } },
        { step: 'start', code: 'BRANCH', type: 'SITE', capture: 'CREATION', config: { level: 2 } },
        { step: 'start', code: 'POSITION', type: 'SELECT', capture: 'CREATION', dataSource: { kind: 'PRESET', preset: 'POSITIONS' } },
        { step: 'start', code: 'NOTES', type: 'TEXT', capture: 'CREATION' },
      ],
    });
    for (const code of ['CASHIER', 'ANYONE', 'BRANCH', 'POSITION', 'NOTES']) {
      fields[code] = (await db.owner.query<{ id: string }>('SELECT id::text FROM fields WHERE version_id = $1 AND code = $2', [flow.versionId, code])).rows[0]!.id;
    }
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('offers the active people of the field positions, by name, each word in the first or last name', async () => {
    expect((await options('CASHIER').expect(200)).body).toEqual({ options: [{ value: teller.userId, label: 'Zoe Caja Uno' }] });
    expect((await options('ANYONE', { q: 'z caja' }).expect(200)).body).toEqual({ options: [{ value: teller.userId, label: 'Zoe Caja Uno' }] });
    expect((await options('ANYONE', { q: 'zelda auditora' }).expect(200)).body.options).toEqual([{ value: auditor.userId, label: 'Zelda Auditora' }]);
  });

  it('offers the active sites of the field level, with % taken literally, and at most limit', async () => {
    expect((await options('BRANCH', { q: branch }).expect(200)).body.options.map((option: { label: string }) => option.label)).toEqual([`${branch} Norte 100%`, `${branch} Sur`]);
    expect((await options('BRANCH', { q: '100%' }).expect(200)).body.options.map((option: { label: string }) => option.label)).toEqual([`${branch} Norte 100%`]);
    expect((await options('BRANCH', { q: branch, limit: '1' }).expect(200)).body.options).toHaveLength(1);
  });

  it('offers the entries of a preset list', async () => {
    expect((await options('POSITION').expect(200)).body.options).toContainEqual({ value: cashier, label: expect.stringMatching(/^Cashier/) });
  });

  it('offers only values the submission accepts', async () => {
    const site = (await options('BRANCH', { q: 'Sur' }).expect(200)).body.options[0].value as string;
    await filler.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Ticket'), values: { CASHIER: teller.userId, BRANCH: site, POSITION: cashier, ANYONE: [auditor.userId] } }).expect(201);
    await filler.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Ticket'), values: { CASHIER: auditor.userId } }).expect(422);
  });

  it('needs a form-filling permission, and answers 404 for a field that stores no ids', async () => {
    const outsider = await world.member([{ action: 'read_created', subject: 'Ticket' }]);
    await outsider.client.get(`/fields/${fields.CASHIER}/options`).expect(403);
    await options('NOTES').expect(404);
    await filler.client.get('/fields/018f0000-0000-7000-8000-000000000000/options').expect(404);
  });
});
