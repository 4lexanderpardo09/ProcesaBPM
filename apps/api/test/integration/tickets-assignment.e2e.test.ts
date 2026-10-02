import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

describe('assignment, pool, reassignment', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;

  const count = async () => Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n);
  const create = (flow: PublishedFlow, body: Record<string, unknown> = {}, as = requester) => as.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values: {}, ...body });
  const flowWith = (taskExtra: Record<string, unknown>, candidates?: ReadonlyArray<Record<string, unknown>>) => publishFlow(world.admin, simpleFlow(taskExtra, candidates === undefined ? {} : { candidates }));
  const site = (parentId: string | null, level: number) => insertReturningId(db.platform, `INSERT INTO sites (tenant_id, parent_id, level, name) VALUES ($1, $2, $3, $4) RETURNING id`, [world.tenant.tenantId, parentId, level, unique('Site')]);
  const user = (userId: string) => ({ participantType: 'USER', userId });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member(REQUESTER_GRANTS);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('by position', () => {
    it('one holder is the assignee; several make a pool with a single clock nobody owns yet', async () => {
      const [lone, shared] = [await world.position(), await world.position()];
      const holder = await world.member(WORKER_GRANTS, { positionId: lone });
      const [a, b] = [await world.member(WORKER_GRANTS, { positionId: shared }), await world.member(WORKER_GRANTS, { positionId: shared })];

      const single = await create(await flowWith({ assignmentMode: 'POSITION', positionId: lone, siteScope: 'ANY_SITE' })).expect(201);
      expect(await world.assignees(single.body.id)).toEqual([{ user_id: holder.userId, type: 'PRIMARY' }]);
      expect((await world.clocks(single.body.id)).map((clock) => clock.responsible_id)).toEqual([holder.userId]);

      const pooled = await create(await flowWith({ assignmentMode: 'POSITION', positionId: shared, siteScope: 'ANY_SITE' })).expect(201);
      expect((await world.assignees(pooled.body.id)).map((row) => [row.user_id, row.type]).sort()).toEqual([[a.userId, 'POOL'], [b.userId, 'POOL']].sort());
      expect((await world.clocks(pooled.body.id)).map((clock) => clock.responsible_id)).toEqual([null]);
    });

    it('people of other companies, inactive members and disabled users are not candidates', async () => {
      const position = await world.position();
      const eligible = await world.member(WORKER_GRANTS, { positionId: position });
      const otherCompany = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
      const elsewhere = await world.member(WORKER_GRANTS, { positionId: position });
      await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, elsewhere.userId, otherCompany]);
      await db.platform.query(`DELETE FROM membership_companies WHERE tenant_id = $1 AND user_id = $2 AND company_id = $3`, [world.tenant.tenantId, elsewhere.userId, world.tenant.companyId]);
      const inactive = await world.member(WORKER_GRANTS, { positionId: position });
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, inactive.userId]);
      const disabled = await world.member(WORKER_GRANTS, { positionId: position });
      await db.platform.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled.userId]);

      const created = await create(await flowWith({ assignmentMode: 'POSITION', positionId: position, siteScope: 'ANY_SITE' })).expect(201);
      expect(await world.assignees(created.body.id)).toEqual([{ user_id: eligible.userId, type: 'PRIMARY' }]);
    });

    it('a step with nobody to assign refuses the creation and rolls everything back', async () => {
      const flow = await flowWith({ assignmentMode: 'POSITION', positionId: await world.position(), siteScope: 'ANY_SITE' });
      const before = await count();
      const refused = await create(flow).expect(422);
      expect(refused.body.error).toMatchObject({ code: 'NO_ASSIGNEE_CANDIDATES', details: { stepId: flow.step.task, mode: 'POSITION' } });
      expect(await count()).toBe(before);
    });

    describe('site scope', () => {
      it('SAME_SITE only takes people of the site of the ticket (the requester\'s)', async () => {
        const position = await world.position();
        const [bogota, medellin] = [await site(null, 1), await site(null, 1)];
        const here = await world.member(WORKER_GRANTS, { positionId: position, siteId: bogota });
        await world.member(WORKER_GRANTS, { positionId: position, siteId: medellin });
        const local = await world.member(REQUESTER_GRANTS, { siteId: bogota });
        const flow = await flowWith({ assignmentMode: 'POSITION', positionId: position, siteScope: 'SAME_SITE' });

        const created = await create(flow, {}, local).expect(201);
        expect(await world.assignees(created.body.id)).toEqual([{ user_id: here.userId, type: 'PRIMARY' }]);
        expect((await world.ticketRow(created.body.id)).site_id).toBe(bogota);
      });

      it('PARENT_SITE climbs to the nearest ancestor that has candidates', async () => {
        const position = await world.position();
        const country = await site(null, 1);
        const city = await site(country, 2);
        const branch = await site(city, 3);
        const national = await world.member(WORKER_GRANTS, { positionId: position, siteId: country });
        const local = await world.member(REQUESTER_GRANTS, { siteId: branch });
        const flow = await flowWith({ assignmentMode: 'POSITION', positionId: position, siteScope: 'PARENT_SITE' });

        expect(await world.assignees((await create(flow, {}, local).expect(201)).body.id)).toEqual([{ user_id: national.userId, type: 'PRIMARY' }]);
        const cityLevel = await world.member(WORKER_GRANTS, { positionId: position, siteId: city });
        expect(await world.assignees((await create(flow, {}, local).expect(201)).body.id)).toEqual([{ user_id: cityLevel.userId, type: 'PRIMARY' }]);
      });

      it('a ticket without a site ignores the scope', async () => {
        const position = await world.position();
        const anywhere = await world.member(WORKER_GRANTS, { positionId: position, siteId: await site(null, 1) });
        const flow = await flowWith({ assignmentMode: 'POSITION', positionId: position, siteScope: 'SAME_SITE' });
        expect(await world.assignees((await create(flow).expect(201)).body.id)).toEqual([{ user_id: anywhere.userId, type: 'PRIMARY' }]);
      });
    });
  });

  describe('explicit candidates', () => {
    let first: Member;
    let second: Member;
    let outsider: Member;

    beforeAll(async () => {
      [first, second, outsider] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    });

    it('USERS without manual selection makes a pool of the candidates', async () => {
      const created = await create(await flowWith({ assignmentMode: 'USERS' }, [user(first.userId), user(second.userId)])).expect(201);
      expect((await world.assignees(created.body.id)).map((row) => row.type)).toEqual(['POOL', 'POOL']);
    });

    it('GROUP assigns the active members of its groups; an inactive group has nobody', async () => {
      const group = await world.group([first.userId, second.userId]);
      const flow = await flowWith({ assignmentMode: 'GROUP' }, [{ participantType: 'GROUP', groupId: group }]);
      expect((await world.assignees((await create(flow).expect(201)).body.id)).map((row) => row.user_id).sort()).toEqual([first.userId, second.userId].sort());
      await db.platform.query(`UPDATE groups SET is_active = false WHERE id = $1`, [group]);
      expect((await create(flow).expect(422)).body.error.code).toBe('NO_ASSIGNEE_CANDIDATES');
    });

    it('POOL joins users, groups and the position, without repeating anybody', async () => {
      const position = await world.position();
      const holder = await world.member(WORKER_GRANTS, { positionId: position });
      const group = await world.group([first.userId, holder.userId]);
      const flow = await flowWith({ assignmentMode: 'POOL', positionId: position, siteScope: 'ANY_SITE' }, [user(first.userId), user(second.userId), { participantType: 'GROUP', groupId: group }]);
      const rows = await world.assignees((await create(flow).expect(201)).body.id);
      expect(rows.map((row) => row.user_id).sort()).toEqual([first.userId, second.userId, holder.userId].sort());
      expect(rows.every((row) => row.type === 'POOL')).toBe(true);
    });

    describe('manual selection', () => {
      let flow: PublishedFlow;
      beforeAll(async () => {
        flow = await flowWith({ assignmentMode: 'USERS', manualSelection: true }, [user(first.userId), user(second.userId)]);
      });

      it('asks for the choice, listing the candidates, and creates nothing', async () => {
        const before = await count();
        const asked = await create(flow).expect(422);
        expect(asked.body.error.code).toBe('ASSIGNEE_SELECTION_REQUIRED');
        expect(asked.body.error.details.stepId).toBe(flow.step.task);
        expect(asked.body.error.details.candidates.map((candidate: { userId: string }) => candidate.userId).sort()).toEqual([first.userId, second.userId].sort());
        expect(await count()).toBe(before);
      });

      it('assigns the chosen candidate', async () => {
        const created = await create(flow, { assigneeId: second.userId }).expect(201);
        expect(await world.assignees(created.body.id)).toEqual([{ user_id: second.userId, type: 'PRIMARY' }]);
      });

      it('rejects someone who is not a candidate, even a valid member of the tenant', async () => {
        const before = await count();
        expect((await create(flow, { assigneeId: outsider.userId }).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE');
        expect((await create(flow, { assigneeId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE');
        expect(await count()).toBe(before);
      });
    });
  });

  describe('creator and approver', () => {
    it('CREATOR assigns the requester', async () => {
      const created = await create(await flowWith({})).expect(201);
      expect(await world.assignees(created.body.id)).toEqual([{ user_id: requester.userId, type: 'PRIMARY' }]);
    });

    it('APPROVER without an approver for the requester fails with APPROVER_NOT_FOUND', async () => {
      const typeId = (await world.admin.post('/approval-group-types', { name: unique('Type') }).expect(201)).body.id as string;
      const flow = await flowWith({ assignmentMode: 'APPROVER', approvalGroupTypeId: typeId, approvalLevel: 1 });
      expect((await create(flow).expect(422)).body.error.code).toBe('APPROVER_NOT_FOUND');
    });
  });

  describe('who may start the workflow', () => {
    it('restricts the START block to its initiators', async () => {
      const position = await world.position();
      const allowed = await world.member(REQUESTER_GRANTS, { positionId: position });
      const flow = await publishFlow(world.admin, {
        ...simpleFlow(),
        steps: simpleFlow().steps.map((step) => (step.key === 'start' ? { ...step, initiators: [{ participantType: 'POSITION', positionId: position }] } : step)),
      });
      expect((await create(flow, {}, requester).expect(403)).body.error.code).toBe('INITIATOR_NOT_ALLOWED');
      await create(flow, {}, allowed).expect(201);
    });
  });

  describe('taking from a pool and reassigning', () => {
    let a: Member;
    let b: Member;
    let supervisor: Member;
    let flow: PublishedFlow;

    beforeAll(async () => {
      [a, b, supervisor] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(SUPERVISOR_GRANTS)];
      flow = await flowWith({ assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, [user(a.userId), user(b.userId)]);
    });

    it('the first to take it gets it; the other hears it was taken; the clock keeps running', async () => {
      const created = await create(flow).expect(201);
      const [first, second] = await Promise.all([
        a.client.post(`/tickets/${created.body.id}/take`, { visitId: created.body.openVisitId }),
        b.client.post(`/tickets/${created.body.id}/take`, { visitId: created.body.openVisitId }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const winner = first.status === 200 ? a : b;
      expect(await world.assignees(created.body.id)).toEqual([{ user_id: winner.userId, type: 'PRIMARY' }]);
      const clocks = await world.clocks(created.body.id);
      expect(clocks).toHaveLength(1);
      expect(clocks[0]).toMatchObject({ responsible_id: winner.userId, completed_at: null });
      expect((await world.events(created.body.id)).at(-1)).toMatchObject({ type: 'ASSIGNED', assignee_id: winner.userId, data: { tookFromPool: true } });
    });

    it('someone who is not in the pool cannot take the ticket', async () => {
      const created = await create(flow).expect(201);
      const stranger = await world.member(WORKER_GRANTS);
      expect((await stranger.client.post(`/tickets/${created.body.id}/take`, { visitId: created.body.openVisitId })).status).toBe(404);
    });

    it('a member of the pool can answer without taking it first', async () => {
      const created = await create(flow).expect(201);
      const done = await b.client.post(`/tickets/${created.body.id}/transition`, { transitionId: flow.transition.Done, visitId: created.body.openVisitId });
      expect(done.status).toBe(200);
      expect((await world.events(created.body.id)).find((event) => event.actor_id === b.userId)?.data).toMatchObject({ tookFromPool: true });
      expect((await world.clocks(created.body.id)).map((clock) => clock.responsible_id)).toEqual([b.userId]);
      expect((await b.client.get(`/tickets/${created.body.id}`)).status).toBe(200);
    });

    it('reassigning closes the previous clock, starts a new one and leaves the visit alone', async () => {
      const created = await create(flow).expect(201);
      await a.client.post(`/tickets/${created.body.id}/take`, { visitId: created.body.openVisitId }).expect(200);
      const before = await world.visits(created.body.id);

      const moved = await supervisor.client.post(`/tickets/${created.body.id}/reassign`, { toUserId: b.userId, visitId: created.body.openVisitId, comment: 'Please cover' }).expect(200);
      expect(moved.body.openVisitId).toBe(created.body.openVisitId);
      expect(await world.assignees(created.body.id)).toEqual([{ user_id: b.userId, type: 'PRIMARY' }]);
      const clocks = await world.clocks(created.body.id);
      expect(clocks.map((clock) => [clock.responsible_id, clock.completed_at !== null, clock.result !== null])).toEqual([[a.userId, true, true], [b.userId, false, false]]);
      expect(await world.visits(created.body.id)).toEqual(before);
      expect((await world.events(created.body.id)).at(-1)).toMatchObject({ type: 'REASSIGNED', actor_id: supervisor.userId, assignee_id: b.userId, data: { fromUserIds: [a.userId] } });
      expect(await world.outbox('ticket.assigned', created.body.id)).toHaveLength(4);
    });

    it('can hand the ticket back to someone who held it before', async () => {
      const created = await create(flow).expect(201);
      await a.client.post(`/tickets/${created.body.id}/take`, { visitId: created.body.openVisitId }).expect(200);
      await supervisor.client.post(`/tickets/${created.body.id}/reassign`, { toUserId: b.userId, visitId: created.body.openVisitId }).expect(200);
      await supervisor.client.post(`/tickets/${created.body.id}/reassign`, { toUserId: a.userId, visitId: created.body.openVisitId }).expect(200);
      expect((await world.clocks(created.body.id)).filter((clock) => clock.completed_at === null).map((clock) => clock.responsible_id)).toEqual([a.userId]);
    });

    it('the target must be an active member of the ticket company and not already the only assignee', async () => {
      const created = await create(flow).expect(201);
      await a.client.post(`/tickets/${created.body.id}/take`, { visitId: created.body.openVisitId }).expect(200);
      const otherCompany = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
      const foreign = await world.member(WORKER_GRANTS);
      await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, foreign.userId, otherCompany]);
      await db.platform.query(`DELETE FROM membership_companies WHERE tenant_id = $1 AND user_id = $2 AND company_id = $3`, [world.tenant.tenantId, foreign.userId, world.tenant.companyId]);
      const ghost = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
      for (const toUserId of [ghost, a.userId, foreign.userId]) {
        const refused = await supervisor.client.post(`/tickets/${created.body.id}/reassign`, { toUserId, visitId: created.body.openVisitId });
        expect([refused.status, refused.body.error.code]).toEqual([422, 'INVALID_ASSIGNEE']);
      }
    });

    it('needs the reassign permission', async () => {
      const created = await create(flow).expect(201);
      expect((await a.client.post(`/tickets/${created.body.id}/reassign`, { toUserId: b.userId, visitId: created.body.openVisitId })).status).toBe(403);
    });

    it('an answer with a manual selection picks the next assignee among the candidates', async () => {
      const reviewer = await world.member(WORKER_GRANTS);
      const [x, y, z] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
      const spec: FlowSpec = {
        steps: [
          { key: 'start', type: 'START' },
          { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(reviewer.userId)] },
          { key: 'work', type: 'TASK', extra: { assignmentMode: 'USERS', manualSelection: true }, candidates: [user(x.userId), user(y.userId)] },
          { key: 'end', type: 'END' },
        ],
        transitions: [
          { from: 'start', to: 'review', type: 'DEFAULT' },
          { from: 'review', to: 'work', type: 'DECISION', label: 'Assign' },
          { from: 'work', to: 'end', type: 'DECISION', label: 'Finish' },
        ],
      };
      const published = await publishFlow(world.admin, spec);
      const created = await create(published).expect(201);
      const send = (body: Record<string, unknown>) => reviewer.client.post(`/tickets/${created.body.id}/transition`, { transitionId: published.transition.Assign, visitId: created.body.openVisitId, ...body });
      expect((await send({}).expect(422)).body.error.code).toBe('ASSIGNEE_SELECTION_REQUIRED');
      expect((await send({ assigneeId: z.userId }).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE');
      await send({ assigneeId: y.userId }).expect(200);
      expect(await world.assignees(created.body.id)).toEqual([{ user_id: y.userId, type: 'PRIMARY' }]);
      expect((await world.ticketRow(created.body.id)).current_step_id).toBe(published.step.work);
    });
  });

  describe('features the engine does not run yet', () => {
    it('refuses to publish a workflow with a WAIT block', async () => {
      const refusals = async (spec: FlowSpec) => {
        const category = (await world.admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id;
        const subcategoryId = (await world.admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id;
        const workflow = (await world.admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
        const base = `/workflows/${workflow.id}/versions/${workflow.versions[0].id}`;
        await world.admin
          .put(`${base}/graph`, {
            revision: 0,
            steps: spec.steps.map((step) => ({ id: `new:${step.key}`, type: step.type, name: step.key, ...(step.type === 'TASK' ? { assignmentMode: 'CREATOR' } : {}), ...step.extra })),
            transitions: spec.transitions.map((entry, index) => ({ id: `new:t${index}`, fromStepId: `new:${entry.from}`, toStepId: `new:${entry.to}`, type: entry.type, label: `t${index}` })),
          })
          .expect(200);
        const published = await world.admin.post(`${base}/publish`, {}).expect(422);
        return (published.body.error.details.errors as Array<{ code: string }>).map((problem) => problem.code);
      };
      const wait = { steps: [{ key: 'start', type: 'START' as const }, { key: 'w', type: 'WAIT' as const, extra: { config: { mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' } } }, { key: 'end', type: 'END' as const }], transitions: [{ from: 'start', to: 'w', type: 'DEFAULT' as const }, { from: 'w', to: 'end', type: 'DEFAULT' as const }] };
      expect(await refusals(wait)).toContain('NOT_IMPLEMENTED_WAIT_BLOCK');
      const ID = '0199a000-0000-7000-8000-0000000000bb';
      const blocks = [
        ['NOTIFICATION' as const, { recipients: [{ kind: 'CREATOR' }], channels: ['EMAIL'], subject: 's', body: 'b' }, 'NOT_IMPLEMENTED_NOTIFICATION_BLOCK'],
        ['WEBHOOK' as const, { webhookId: ID }, 'NOT_IMPLEMENTED_WEBHOOK_BLOCK'],
        ['EXPORT' as const, { exportDefinitionId: ID }, 'NOT_IMPLEMENTED_EXPORT_BLOCK'],
      ];
      for (const [type, config, code] of blocks) {
        const flow = { steps: [{ key: 'start', type: 'START' as const }, { key: 'b', type, extra: { config } }, { key: 'end', type: 'END' as const }], transitions: [{ from: 'start', to: 'b', type: 'DEFAULT' as const }, { from: 'b', to: 'end', type: 'DEFAULT' as const }] };
        expect(await refusals(flow)).toContain(code);
      }
    });

    it('a version published before the engine refused them is not started', async () => {
      const flow = await flowWith({});
      // Published versions are immutable: simulate an old one by flipping a step the way an earlier engine allowed it.
      await db.owner.query(`ALTER TABLE steps DISABLE TRIGGER USER`);
      try {
        await db.owner.query(`UPDATE steps SET deadline_type = 'CUTOFF', deadline_field_code = 'DUE', deadline_business_days = 2 WHERE id = $1`, [flow.step.task]);
      } finally {
        await db.owner.query(`ALTER TABLE steps ENABLE TRIGGER USER`);
      }
      const refused = await create(flow).expect(501);
      expect(refused.body.error.code).toBe('NOT_IMPLEMENTED');
    });
  });
});
