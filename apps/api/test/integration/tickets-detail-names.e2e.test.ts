import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { ticketDetailResponseSchema, type TicketDetailResponse, type TicketEventResponse, ticketTimelineResponseSchema } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('GET /tickets/:id and /timeline: names next to the ids', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let flow: PublishedFlow;
  let creator: Member;
  let registrar: Member;
  let worker: Member;
  let helper: Member;
  let picked: Member;
  let reader: Member;
  let stranger: Member;
  let site: { id: string; name: string };
  let department: { id: string; name: string };
  let ticket: { id: string; openVisitId: string };

  const nameOf = async (member: Member) =>
    (await db.platform.query<{ name: string }>(`SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1`, [member.userId])).rows[0]!.name;
  const person = async (member: Member) => ({ id: member.userId, name: await nameOf(member) });
  const detailFor = async (member: Member, id = ticket.id): Promise<TicketDetailResponse> => ticketDetailResponseSchema.parse((await member.client.get(`/tickets/${id}`).expect(200)).body);
  const timelineFor = async (member: Member, id = ticket.id): Promise<TicketEventResponse[]> => ticketTimelineResponseSchema.parse((await member.client.get(`/tickets/${id}/timeline`).expect(200)).body);
  const setValue = (code: string, value: unknown) =>
    db.platform.query(
      `UPDATE ticket_field_values v SET value = $3::jsonb FROM fields f WHERE f.tenant_id = v.tenant_id AND f.id = v.field_id AND v.ticket_id = $1 AND f.code = $2`,
      [ticket.id, code, JSON.stringify(value)],
    );

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    site = { name: unique('Bogota'), id: '' };
    site.id = (await world.admin.post('/sites', { name: site.name }).expect(201)).body.id as string;
    department = { name: unique('Treasury'), id: '' };
    department.id = (await world.admin.post('/departments', { name: department.name }).expect(201)).body.id as string;
    creator = await world.member(REQUESTER_GRANTS, { siteId: site.id, departmentId: department.id });
    registrar = await world.member([grant('create_for_others'), grant('read_created')]);
    worker = await world.member([...WORKER_GRANTS, grant('open_incident')]);
    helper = await world.member(WORKER_GRANTS);
    picked = await world.member([]);
    reader = await world.member([grant('read_all')]);
    stranger = await world.member([grant('read_created'), grant('read_assigned'), grant('read_observed')]);
    flow = await publishFlow(world.admin, {
      ...simpleFlow({ assignmentMode: 'USERS' }, { name: 'Review', candidates: [user(worker)] }),
      fields: [
        { step: 'start', code: 'APPROVER', type: 'USER', capture: 'CREATION' },
        { step: 'start', code: 'BRANCH', type: 'SITE', capture: 'CREATION' },
        { step: 'start', code: 'PEOPLE', type: 'MULTI_SELECT', capture: 'CREATION', dataSource: { kind: 'PRESET', preset: 'USERS' } },
        { step: 'start', code: 'NOTE', type: 'TEXT', capture: 'CREATION' },
      ],
    });
    ticket = (
      await registrar.client
        .post('/tickets', {
          subcategoryId: flow.subcategoryId,
          requesterId: creator.userId,
          title: unique('Named'),
          values: { APPROVER: picked.userId, BRANCH: site.id, PEOPLE: [picked.userId, helper.userId], NOTE: picked.userId },
        })
        .expect(201)
    ).body;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('the detail', () => {
    it('keeps the ids and names the company, who registered it, its department and site', async () => {
      const company = (await db.platform.query<{ id: string; name: string }>(`SELECT c.id, c.name FROM tickets t JOIN companies c ON c.tenant_id = t.tenant_id AND c.id = t.company_id WHERE t.id = $1`, [ticket.id])).rows[0]!;
      expect(await detailFor(reader)).toMatchObject({
        companyId: company.id,
        company,
        creator: await person(creator),
        registeredById: registrar.userId,
        registeredBy: await person(registrar),
        closedBy: null,
        departmentId: department.id,
        department,
        siteId: site.id,
        site,
        currentStep: { id: flow.step.task, name: 'Review' },
      });
    });

    it('names the people and sites the values point to, and only those', async () => {
      const detail = await detailFor(creator);
      expect(detail.values).toMatchObject({ APPROVER: picked.userId, BRANCH: site.id, NOTE: picked.userId });
      expect(detail.valueNames).toEqual({ users: { [picked.userId]: await nameOf(picked), [helper.userId]: await nameOf(helper) }, sites: { [site.id]: site.name } });
    });

    it('names both people of the open incident', async () => {
      await worker.client.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId: helper.userId, description: 'Missing a document' }).expect(201);
      expect((await detailFor(reader)).openIncident).toMatchObject({ assignedToId: helper.userId, createdById: worker.userId, assignedTo: await person(helper), createdBy: await person(worker) });
    });

    it('a member who cannot read the ticket gets 404, so none of its names', async () => {
      expect((await stranger.client.get(`/tickets/${ticket.id}`)).status).toBe(404);
      expect((await stranger.client.get(`/tickets/${ticket.id}/timeline`)).status).toBe(404);
    });
  });

  describe('the timeline', () => {
    it('names the actor, the assignee, the step and the transition of each event, keeping their ids', async () => {
      const events = await timelineFor(creator);
      const created = events.find((event) => event.type === 'CREATED')!;
      expect(created).toMatchObject({ actorId: registrar.userId, actor: await person(registrar) });
      const assigned = events.find((event) => event.type === 'ASSIGNED' && event.assigneeId === worker.userId)!;
      expect(assigned).toMatchObject({ stepId: flow.step.task, step: { id: flow.step.task, name: 'Review' }, assignee: await person(worker) });
      for (const event of events) {
        expect(event.actor?.id ?? null).toBe(event.actorId);
        expect(event.assignee?.id ?? null).toBe(event.assigneeId);
        expect(event.step?.id ?? null).toBe(event.stepId);
        expect(event.transition?.id ?? null).toBe(event.transitionId);
      }
    });

    it('names the transition by its label once the ticket moves on', async () => {
      const incident = (await db.platform.query<{ id: string }>(`SELECT id FROM ticket_incidents WHERE ticket_id = $1 AND status = 'OPEN'`, [ticket.id])).rows[0]!;
      await helper.client.post(`/tickets/${ticket.id}/incidents/${incident.id}/resolve`, { resolution: 'Sent' }).expect(200);
      await worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Done!, visitId: ticket.openVisitId, values: {} }).expect(200);
      const transitioned = (await timelineFor(reader)).filter((event) => event.transitionId === flow.transition.Done);
      expect(transitioned.length).toBeGreaterThan(0);
      for (const event of transitioned) expect(event.transition).toEqual({ id: flow.transition.Done, name: 'Done' });
      const detail = await detailFor(reader);
      expect(detail).toMatchObject({ status: 'CLOSED', closedById: worker.userId, closedBy: await person(worker) });
    });
  });

  describe('tenant isolation', () => {
    it('ids of another tenant, or of nothing, in the values resolve to no name', async () => {
      const foreign = await TicketWorld.create(db, app);
      const foreignMember = await foreign.member([]);
      const foreignSite = (await foreign.admin.post('/sites', { name: unique('Foreign') }).expect(201)).body.id as string;
      const nobody = randomUUID();
      await setValue('APPROVER', foreignMember.userId);
      await setValue('BRANCH', foreignSite);
      await setValue('PEOPLE', [nobody, 'not-an-id', picked.userId]);
      const detail = await detailFor(reader);
      expect(detail.values).toMatchObject({ APPROVER: foreignMember.userId, BRANCH: foreignSite });
      expect(detail.valueNames).toEqual({ users: { [picked.userId]: await nameOf(picked) }, sites: {} });
    });

    it('another tenant cannot read the ticket or its timeline', async () => {
      const foreign = await TicketWorld.create(db, app);
      expect((await foreign.admin.get(`/tickets/${ticket.id}`)).status).toBe(404);
      expect((await foreign.admin.get(`/tickets/${ticket.id}/timeline`)).status).toBe(404);
    });
  });
});
