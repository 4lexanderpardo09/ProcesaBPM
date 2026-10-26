import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import { type TicketActionsResponse, ticketCandidatesResponseSchema, ticketDetailResponseSchema } from '@procesabpm/shared';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string, conditions?: unknown) => ({ action, subject: 'Ticket', ...(conditions === undefined ? {} : { conditions }) });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });
const signer = (member: Member) => ({ signerType: 'USER', userId: member.userId });

type ActionName = keyof TicketActionsResponse;
const ACTION_NAMES: readonly ActionName[] = ['advance', 'take', 'reassign', 'close', 'openIncident', 'resolveIncident', 'reopen', 'signParallelTask', 'comment', 'reportError', 'edit'];
const NOTHING: TicketActionsResponse = { advance: false, take: false, reassign: false, close: false, openIncident: false, resolveIncident: false, reopen: false, signParallelTask: false, comment: false, reportError: false, edit: false };

/** A ticket in the state a scenario needs; a fresh one for every probe, as each action changes it. */
interface Situation {
  readonly ticketId: string;
  readonly visitId: string | null;
}

describe('what the caller may do on a ticket, and who they can hand it to', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let second: Member;
  let helper: Member;
  let supervisor: Member;
  let reader: Member;
  let single: PublishedFlow;
  let pool: PublishedFlow;
  let parallel: PublishedFlow;
  let noClosing: PublishedFlow;
  let mustClose: PublishedFlow;
  let waiting: PublishedFlow;
  let errorType: string;
  /** A type that is only recorded: reporting it does not move the ticket. */
  let reportType: string;

  const create = async (flow: PublishedFlow): Promise<Situation> => {
    const body = (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values: {} }).expect(201)).body;
    return { ticketId: body.id, visitId: body.openVisitId };
  };
  const detail = async (as: Member, ticketId: string) => (await as.client.get(`/tickets/${ticketId}`).expect(200)).body;
  const actionsOf = async (as: Member, ticketId: string): Promise<TicketActionsResponse> => (await detail(as, ticketId)).actions;
  const openIncident = (as: Member, situation: Situation, assignedToId = helper.userId) =>
    as.client.post(`/tickets/${situation.ticketId}/incidents`, { visitId: situation.visitId ?? randomUUID(), assignedToId, description: '<p>Waiting for a document</p>' });
  const paused = async (flow: PublishedFlow): Promise<Situation> => {
    const situation = await create(flow);
    await openIncident(worker, situation).expect(201);
    return situation;
  };
  const closed = async (): Promise<Situation> => {
    const situation = await create(single);
    await worker.client.post(`/tickets/${situation.ticketId}/transition`, { transitionId: single.transition.Done, visitId: situation.visitId }).expect(200);
    return { ticketId: situation.ticketId, visitId: null };
  };
  const taken = async (): Promise<Situation> => {
    const situation = await create(pool);
    await second.client.post(`/tickets/${situation.ticketId}/take`, { visitId: situation.visitId }).expect(200);
    return situation;
  };
  const signed = async (): Promise<Situation> => {
    const situation = await create(parallel);
    await worker.client.post(`/tickets/${situation.ticketId}/parallel-tasks/sign`, { visitId: situation.visitId }).expect(200);
    return situation;
  };
  const escalated = async (): Promise<Situation> => {
    const situation = await create(mustClose);
    const moved = (await worker.client.post(`/tickets/${situation.ticketId}/transition`, { transitionId: mustClose.transition.Escalate, visitId: situation.visitId }).expect(200)).body;
    return { ticketId: situation.ticketId, visitId: moved.openVisitId };
  };

  /** Each action with a body the route accepts, so its answer depends only on the ticket's state and the caller. */
  const probes: Record<ActionName, (as: Member, situation: Situation) => Promise<Response>> = {
    advance: async (as, { ticketId, visitId }) => {
      const form = (await as.client.get(`/tickets/${ticketId}/form`).expect(200)).body;
      return as.client.post(`/tickets/${ticketId}/transition`, { transitionId: form.decisions[0]?.transitionId ?? randomUUID(), visitId: visitId ?? randomUUID() });
    },
    take: (as, { ticketId, visitId }) => as.client.post(`/tickets/${ticketId}/take`, { visitId: visitId ?? randomUUID() }),
    reassign: async (as, { ticketId, visitId }) => {
      const pending = (await detail(as, ticketId)).parallelTasks.find((task: { status: string }) => task.status === 'PENDING');
      return as.client.post(`/tickets/${ticketId}/reassign`, { visitId: visitId ?? randomUUID(), toUserId: helper.userId, ...(pending === undefined ? {} : { fromUserId: pending.userId }) });
    },
    close: (as, { ticketId, visitId }) => as.client.post(`/tickets/${ticketId}/close`, { visitId: visitId ?? randomUUID() }),
    openIncident: (as, situation) => openIncident(as, situation),
    resolveIncident: async (as, { ticketId }) => {
      const incidentId = (await detail(as, ticketId)).openIncident?.id ?? randomUUID();
      return as.client.post(`/tickets/${ticketId}/incidents/${incidentId}/resolve`, { resolution: 'Solved' });
    },
    reopen: (as, { ticketId }) => as.client.post(`/tickets/${ticketId}/reopen`, { errorTypeId: errorType, description: '<p>The result was wrong</p>' }),
    signParallelTask: (as, { ticketId, visitId }) => as.client.post(`/tickets/${ticketId}/parallel-tasks/sign`, { visitId: visitId ?? randomUUID() }),
    comment: (as, { ticketId }) => as.client.post(`/tickets/${ticketId}/comments`, { comment: '<p>A note</p>' }),
    reportError: (as, { ticketId, visitId }) => as.client.post(`/tickets/${ticketId}/errors`, { visitId: visitId ?? randomUUID(), errorTypeId: reportType, description: '<p>A wrong amount</p>' }),
    edit: (as, { ticketId }) => as.client.patch(`/tickets/${ticketId}`, { title: 'A clearer title' }),
  };

  /**
   * The detail shows exactly `allowed`, and every action agrees with it on a fresh ticket in the same state: a flag
   * that is on means the route goes through; one that is off means the route refuses it for state or permission
   * (never for the body, which is valid).
   */
  async function expectAgreement(as: Member, arrange: () => Promise<Situation>, allowed: readonly ActionName[]): Promise<void> {
    const shown = await actionsOf(as, (await arrange()).ticketId);
    expect(shown).toEqual({ ...NOTHING, ...Object.fromEntries(allowed.map((action) => [action, true])) });
    for (const action of ACTION_NAMES) {
      const response = await probes[action](as, await arrange());
      const outcome = response.status < 300 ? 'accepted' : [403, 404, 409, 422].includes(response.status) ? 'refused' : `unexpected ${response.status} ${JSON.stringify(response.body)}`;
      expect({ action, outcome }).toEqual({ action, outcome: shown[action] ? 'accepted' : 'refused' });
    }
  }

  const namesOf = async (userIds: readonly string[]) =>
    new Map((await db.platform.query<{ id: string; name: string }>(`SELECT id, trim(first_name || ' ' || last_name) AS name FROM users WHERE id = ANY($1::uuid[])`, [userIds])).rows.map((row) => [row.id, row.name]));
  const candidates = (as: Member, ticketId: string, purpose: string) => as.client.get(`/tickets/${ticketId}/candidates?for=${purpose}`);
  const idsOf = (body: Array<{ id: string }>) => body.map((entry) => entry.id);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member([...REQUESTER_GRANTS, grant('comment')]);
    // Reads every ticket, so it still sees the ones it no longer holds (taken from its pool, signed).
    worker = await world.member([...WORKER_GRANTS, grant('read_all'), grant('open_incident'), grant('comment')]);
    second = await world.member([...WORKER_GRANTS, grant('open_incident'), grant('comment')]);
    helper = await world.member([...WORKER_GRANTS, grant('comment')]);
    supervisor = await world.member([...SUPERVISOR_GRANTS, grant('close'), grant('open_incident'), grant('reopen'), grant('comment'), grant('report_error'), grant('update')]);
    reader = await world.member([grant('read_all')]);
    const task = { assignmentMode: 'USERS', closeRule: 'ALLOWED' };
    single = await publishFlow(world.admin, simpleFlow(task, { candidates: [user(worker)] }));
    pool = await publishFlow(world.admin, simpleFlow(task, { candidates: [user(worker), user(second)] }));
    noClosing = await publishFlow(world.admin, simpleFlow({ ...task, closeRule: 'NOT_ALLOWED' }, { candidates: [user(worker)] }));
    const parallelSpec: FlowSpec = {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'sign', type: 'TASK', extra: { assignmentMode: 'PARALLEL' }, signers: [signer(worker), signer(second)] },
        { key: 'rejected', type: 'TASK', extra: { assignmentMode: 'CREATOR' } },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'sign', type: 'DEFAULT' },
        { from: 'sign', to: 'end', type: 'DECISION', label: 'Signed' },
        { from: 'sign', to: 'rejected', type: 'SYSTEM_ONLY', label: 'Rejected' },
        { from: 'rejected', to: 'end', type: 'DECISION', label: 'Closed' },
      ],
    };
    parallel = await publishFlow(world.admin, parallelSpec);
    mustClose = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'work', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] },
        { key: 'closer', type: 'TASK', extra: { assignmentMode: 'USERS', closeRule: 'REQUIRED' }, candidates: [user(worker)] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'work', type: 'DEFAULT' },
        { from: 'work', to: 'end', type: 'DECISION', label: 'Finish' },
        { from: 'work', to: 'closer', type: 'DECISION', label: 'Escalate' },
      ],
    });
    waiting = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'wait', type: 'WAIT', extra: { config: { mode: 'DURATION', value: 2, unit: 'BUSINESS_DAYS' } } },
        { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'wait', type: 'DEFAULT' },
        { from: 'wait', to: 'review', type: 'DEFAULT' },
        { from: 'review', to: 'end', type: 'DECISION', label: 'Done' },
      ],
    });
    errorType = await insertReturningId(db.platform, `INSERT INTO error_types (tenant_id, name, is_reopening, forces_close, is_active, is_process_error) VALUES ($1, $2, true, false, true, false) RETURNING id`, [world.tenant.tenantId, unique('Type')]);
    reportType = await insertReturningId(db.platform, `INSERT INTO error_types (tenant_id, name, is_reopening, forces_close, is_active, is_process_error) VALUES ($1, $2, false, false, true, false) RETURNING id`, [world.tenant.tenantId, unique('Report')]);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('actions in GET /tickets/:id agree with the routes', () => {
    it('the holder of an open step advances, closes, opens an incident and comments', async () => {
      await expectAgreement(worker, () => create(single), ['advance', 'close', 'openIncident', 'comment']);
    });

    it('the requester only comments, and a reader without permissions does nothing', async () => {
      await expectAgreement(requester, () => create(single), ['comment']);
      await expectAgreement(reader, () => create(single), []);
    });

    it('a supervisor reassigns, opens incidents and edits on a step they do not hold, but neither advances nor closes it', async () => {
      await expectAgreement(supervisor, () => create(single), ['reassign', 'openIncident', 'comment', 'reportError', 'edit']);
    });

    it('a pool member takes the ticket (and may answer it right away); once taken by someone else they lost it', async () => {
      await expectAgreement(worker, () => create(pool), ['advance', 'take', 'close', 'openIncident', 'comment']);
      await expectAgreement(worker, taken, ['comment']);
    });

    it('a permission whose stored condition names another company is off for this ticket', async () => {
      const otherCompany = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
      const limited = await world.member([grant('read_assigned'), grant('transition', { companyId: otherCompany }), grant('close', { companyId: otherCompany }), grant('comment')]);
      const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', closeRule: 'ALLOWED' }, { candidates: [user(limited)] }));
      await expectAgreement(limited, () => create(flow), ['comment']);
    });

    it('the close rule of the step decides closing and advancing', async () => {
      await expectAgreement(worker, () => create(noClosing), ['advance', 'openIncident', 'comment']);
      await expectAgreement(worker, escalated, ['close', 'openIncident', 'comment']);
    });

    it('a paused ticket is resolved by the person the incident is for, or whoever opened it; a reader does nothing', async () => {
      await expectAgreement(helper, () => paused(single), ['resolveIncident', 'comment']);
      await expectAgreement(worker, () => paused(single), ['resolveIncident', 'comment']);
      await expectAgreement(reader, () => paused(single), []);
      await expectAgreement(supervisor, () => paused(single), ['resolveIncident', 'comment', 'edit']);
    });

    it('a closed ticket is only reopened, by whoever may; nobody comments on it any more', async () => {
      await expectAgreement(supervisor, closed, ['reopen']);
      await expectAgreement(worker, closed, []);
    });

    it('on a parallel step a pending signer signs; after signing, nothing is left but commenting; a supervisor moves a signature', async () => {
      await expectAgreement(worker, () => create(parallel), ['signParallelTask', 'openIncident', 'comment']);
      await expectAgreement(worker, signed, ['comment']);
      await expectAgreement(supervisor, () => create(parallel), ['reassign', 'openIncident', 'comment', 'reportError', 'edit']);
    });

    it('a ticket parked on a WAIT block only takes comments (and edits from whoever may)', async () => {
      await expectAgreement(supervisor, () => create(waiting), ['comment', 'edit']);
    });

    it('the detail matches the contract the web parses', async () => {
      const body = await detail(worker, (await create(single)).ticketId);
      expect(ticketDetailResponseSchema.safeParse(body).success).toBe(true);
    });
  });

  describe('GET /tickets/:id/candidates', () => {
    let otherCompanyMember: Member;
    let inactive: Member;

    beforeAll(async () => {
      const otherCompany = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
      otherCompanyMember = await world.member(WORKER_GRANTS);
      await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, otherCompanyMember.userId, otherCompany]);
      await db.platform.query(`DELETE FROM membership_companies WHERE tenant_id = $1 AND user_id = $2 AND company_id = $3`, [world.tenant.tenantId, otherCompanyMember.userId, world.tenant.companyId]);
      inactive = await world.member(WORKER_GRANTS);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, inactive.userId]);
    });

    it('reassign: the active members of the ticket company, by name, without the one who already holds it alone', async () => {
      const { ticketId } = await create(single);
      const body = (await candidates(supervisor, ticketId, 'reassign').expect(200)).body;
      expect(ticketCandidatesResponseSchema.safeParse(body).success).toBe(true);
      const ids = idsOf(body);
      expect(ids).toEqual(expect.arrayContaining([helper.userId, second.userId, supervisor.userId, requester.userId]));
      expect(ids).not.toContain(worker.userId);
      expect(ids).not.toContain(otherCompanyMember.userId);
      expect(ids).not.toContain(inactive.userId);
      const names = await namesOf(ids);
      expect(body).toEqual(ids.map((id) => ({ id, name: names.get(id) })));
      const collator = new Intl.Collator('es', { sensitivity: 'base' });
      expect(body.map((entry: { name: string }) => entry.name)).toEqual([...body.map((entry: { name: string }) => entry.name)].sort((a, b) => collator.compare(a, b)));
    });

    it('reassign: any of them is accepted by the reassign route', async () => {
      const situation = await create(single);
      const [first] = (await candidates(supervisor, situation.ticketId, 'reassign').expect(200)).body;
      await supervisor.client.post(`/tickets/${situation.ticketId}/reassign`, { visitId: situation.visitId, toUserId: first.id }).expect(200);
    });

    it('reassign: a pool can go to one of its own members', async () => {
      const ids = idsOf((await candidates(supervisor, (await create(pool)).ticketId, 'reassign').expect(200)).body);
      expect(ids).toEqual(expect.arrayContaining([worker.userId, second.userId]));
    });

    it('reassign: a signature goes to someone who does not sign the step', async () => {
      const situation = await create(parallel);
      const ids = idsOf((await candidates(supervisor, situation.ticketId, 'reassign').expect(200)).body);
      expect(ids).toContain(helper.userId);
      expect(ids).not.toContain(worker.userId);
      expect(ids).not.toContain(second.userId);
    });

    it('incident: the holder may hand it to any active member of the company, themself included', async () => {
      const situation = await create(single);
      const ids = idsOf((await candidates(worker, situation.ticketId, 'incident').expect(200)).body);
      expect(ids).toEqual(expect.arrayContaining([worker.userId, helper.userId, supervisor.userId]));
      expect(ids).not.toContain(otherCompanyMember.userId);
      expect(ids).not.toContain(inactive.userId);
      await openIncident(worker, situation, ids.at(-1)).expect(201);
    });

    it('answers like the action: 403 without its permission on this ticket, 422 when the ticket cannot take it now', async () => {
      const { ticketId } = await create(single);
      // Holds open_incident but not reassign: the route lets them in, the ticket does not.
      expect((await candidates(worker, ticketId, 'reassign')).status).toBe(403);
      // Reads everything and may reassign, but holds no open_incident.
      const noIncidents = await world.member([...SUPERVISOR_GRANTS]);
      expect((await candidates(noIncidents, ticketId, 'incident')).status).toBe(403);
      // Has open_incident but neither holds the step nor may reassign.
      const bystander = await world.member([grant('read_all'), grant('open_incident')]);
      expect((await candidates(bystander, ticketId, 'incident')).status).toBe(403);
      // Neither permission at all: refused at the route.
      expect((await candidates(reader, ticketId, 'reassign')).status).toBe(403);
      const refused = await candidates(supervisor, (await closed()).ticketId, 'reassign');
      expect([refused.status, refused.body.error.code]).toEqual([422, 'TICKET_NOT_OPEN']);
    });

    it('a ticket the caller cannot read, or that does not exist, is not found', async () => {
      const { ticketId } = await create(single);
      const blind = await world.member([grant('reassign'), grant('open_incident')]);
      expect((await candidates(blind, ticketId, 'reassign')).status).toBe(404);
      expect((await candidates(supervisor, randomUUID(), 'reassign')).status).toBe(404);
    });

    it('validates the purpose', async () => {
      const { ticketId } = await create(single);
      expect((await supervisor.client.get(`/tickets/${ticketId}/candidates`)).status).toBe(400);
      expect((await candidates(supervisor, ticketId, 'everyone')).status).toBe(400);
    });

    it('never crosses tenants: another tenant neither sees the ticket nor shows up as a candidate', async () => {
      const { ticketId } = await create(single);
      const elsewhere = await TicketWorld.create(db, app);
      const outsider = await elsewhere.member([...SUPERVISOR_GRANTS, grant('open_incident'), grant('comment')]);
      expect((await outsider.client.get(`/tickets/${ticketId}`)).status).toBe(404);
      expect((await candidates(outsider, ticketId, 'reassign')).status).toBe(404);
      expect((await candidates(outsider, ticketId, 'incident')).status).toBe(404);
      const ids = idsOf((await candidates(supervisor, ticketId, 'reassign').expect(200)).body);
      expect(ids).not.toContain(outsider.userId);
      const own = await publishFlow(elsewhere.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(outsider)] }));
      const requesterThere = await elsewhere.member(REQUESTER_GRANTS);
      const theirs = (await requesterThere.client.post('/tickets', { subcategoryId: own.subcategoryId, title: 'Theirs', values: {} }).expect(201)).body.id as string;
      expect((await supervisor.client.get(`/tickets/${theirs}`)).status).toBe(404);
      expect((await candidates(supervisor, theirs, 'reassign')).status).toBe(404);
      expect(idsOf((await candidates(outsider, theirs, 'incident').expect(200)).body)).not.toContain(supervisor.userId);
    });
  });
});
