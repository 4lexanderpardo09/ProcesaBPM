import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import type { CreateTicketRequest, TicketMutationResponse } from '@procesabpm/shared';
import readXlsxFile from 'read-excel-file/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReportRunner } from '../../src/modules/reports/application/report-runner.js';
import { TenantContext } from '../../src/infrastructure/database/tenant-context.js';
import { CreateTicketService } from '../../src/modules/engine/application/create-ticket.service.js';
import type { TicketActor } from '../../src/modules/engine/application/locked-ticket.js';
import { OpenIncidentService } from '../../src/modules/engine/application/open-incident.service.js';
import { ReassignTicketService } from '../../src/modules/engine/application/reassign-ticket.service.js';
import { ReopenTicketService } from '../../src/modules/engine/application/reopen-ticket.service.js';
import { ResolveIncidentService } from '../../src/modules/engine/application/resolve-incident.service.js';
import { TransitionTicketService } from '../../src/modules/engine/application/transition-ticket.service.js';
import { type ApiClient, clientOf, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedRole, setRolePermissions } from '../support/permission-fixtures.js';
import { TestClock } from '../support/test-clock.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, MONDAY_9AM, publishFlow, type PublishedFlow, simpleFlow, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

/** Bogotá is UTC-5. Monday 2026-09-07; Wednesday 2026-09-09 is a holiday of the test calendar; days run 08-12 and 14-18. */
const bogota = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);
const REPORT_TIME = bogota('2026-09-08', '09:00');
const PERIOD = 'from=2026-09-07&to=2026-09-08';

describe('reports: numbers computed by hand from tickets the real engine moved', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let clock: TestClock;
  let u1: Member;
  let u2: Member;
  let flow: PublishedFlow;
  let companyB: string;
  let reader: ApiClient;
  let openTicketId: string;
  let reopenedTicketId: string;
  let departmentId: string;

  const as = <T>(userId: string, work: () => Promise<T>) => app.get(TenantContext).run({ tenantId: world.tenant.tenantId, userId }, work);
  const actor = (userId: string): TicketActor => ({ userId, can: () => Promise.resolve(true), canRead: () => Promise.resolve(true) });
  const create = (at: Date, extra: Partial<CreateTicketRequest> = {}): Promise<TicketMutationResponse> => {
    clock.set(at);
    return as(u1.userId, () => app.get(CreateTicketService).create({ userId: u1.userId, mayCreate: () => true }, { subcategoryId: flow.subcategoryId, title: 'Request', description: '', values: {}, attachments: [], companyId: world.tenant.companyId, ...extra }));
  };
  const answer = (ticket: TicketMutationResponse, at: Date, userId = u1.userId) => {
    clock.set(at);
    return as(userId, () => app.get(TransitionTicketService).transition(actor(userId), ticket.id, { transitionId: flow.transition.Done!, visitId: ticket.openVisitId!, values: {}, attachments: [] }));
  };
  const get = async (client: ApiClient, path: string, query = PERIOD) => (await client.get(`/reports/${path}${path.includes('?') ? '&' : '?'}${query}`).expect(200)).body;

  beforeAll(async () => {
    db = connectTestDatabase();
    clock = new TestClock(MONDAY_9AM);
    ({ app } = await createTestApp({ clock }));
    world = await TicketWorld.create(db, app);
    [u1, u2] = [await world.member([...WORKER_GRANTS, { action: 'reopen', subject: 'Ticket' }]), await world.member(WORKER_GRANTS)];
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', slaValue: 4, slaUnit: 'BUSINESS_HOURS' }, { candidates: [{ participantType: 'USER', userId: u1.userId }] }));
    companyB = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
    departmentId = (await world.admin.post('/departments', { name: unique('Dept') }).expect(201)).body.id as string;
    await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, u1.userId, companyB]);
    const errorType = await insertReturningId(db.platform, `INSERT INTO error_types (tenant_id, name, is_reopening) VALUES ($1, $2, true) RETURNING id`, [world.tenant.tenantId, unique('Wrong')]);

    // T1: on time. 09:00 → 11:00 is 120 business minutes.
    await answer(await create(bogota('2026-09-07', '09:00')), bogota('2026-09-07', '11:00'));
    // T2: an incident from 10:00 to 15:00 pauses 10-12 and 14-15 = 180 business minutes; 09:00 → 16:00 is 300 gross, 120 net.
    const t2 = await create(bogota('2026-09-07', '09:00'));
    clock.set(bogota('2026-09-07', '10:00'));
    const incident = await as(u1.userId, () => app.get(OpenIncidentService).open(actor(u1.userId), t2.id, { visitId: t2.openVisitId!, assignedToId: u2.userId, description: '<p>Paused</p>' }));
    clock.set(bogota('2026-09-07', '15:00'));
    await as(u2.userId, () => app.get(ResolveIncidentService).resolve(actor(u2.userId), t2.id, incident.incidentId, { resolution: 'Done' }));
    await answer(t2, bogota('2026-09-07', '16:00'));
    // T3: reassigned to U2 at 14:00 (U1 had 180 minutes), U2 answers at 16:00 (120 minutes for them, 300 for the step: late).
    const t3 = await create(bogota('2026-09-07', '09:00'));
    clock.set(bogota('2026-09-07', '14:00'));
    await as(u1.userId, () => app.get(ReassignTicketService).reassign({ ...actor(u1.userId), can: () => Promise.resolve(true) }, t3.id, { toUserId: u2.userId, visitId: t3.openVisitId! }));
    await answer(t3, bogota('2026-09-07', '16:00'), u2.userId);
    // T4: late. 09:00 → 16:00 is 300 minutes for a 4 hour SLA.
    await answer(await create(bogota('2026-09-07', '09:00')), bogota('2026-09-07', '16:00'));
    // T5: answered in 60, reopened because of an error of U1, answered again in 30.
    const t5 = await create(bogota('2026-09-07', '09:00'));
    reopenedTicketId = t5.id;
    await answer(t5, bogota('2026-09-07', '10:00'));
    clock.set(bogota('2026-09-08', '08:30'));
    const reopened = await as(u2.userId, () => app.get(ReopenTicketService).reopen(actor(u2.userId), t5.id, { errorTypeId: errorType, description: '<p>Wrong</p>', assigneeId: u1.userId }));
    await answer({ ...t5, openVisitId: (reopened as { openVisitId: string }).openVisitId }, bogota('2026-09-08', '09:00'));
    // T6: still open, created Monday 09:00 (overdue since 15:00).
    openTicketId = (await create(bogota('2026-09-07', '09:00'))).id;
    // T7: another company, answered in 30 minutes.
    await answer(await create(bogota('2026-09-07', '09:00'), { companyId: companyB }), bogota('2026-09-07', '09:30'));

    // Tokens read the fake clock: the reader signs in at the moment the reports are asked.
    clock.set(REPORT_TIME);
    reader = await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report' }, { action: 'export', subject: 'Report' }]);
  });

  // Tokens read the fake clock: every test asks its reports at the moment the reader signed in.
  beforeEach(() => clock.set(REPORT_TIME));

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('company A (the default one)', () => {
    const A = () => `${PERIOD}&companyId=${world.tenant.companyId}`;

    it('summary: counts, on-time percentages and resolution time', async () => {
      const summary = await get(reader, 'summary', A());
      expect(summary).toMatchObject({ created: 6, closed: 5, open: 1, stepOnTimePct: 66.7, responsibleOnTimePct: 85.7, avgResolutionMin: 186, medianResolutionMin: 120, unmeasuredTickets: 0, timeZones: ['America/Bogota'] });
    });

    it('SLA per responsible: each person is measured from their own clock, net of pauses', async () => {
      const { items } = await get(reader, 'sla/responsibles', A());
      const byUser = Object.fromEntries(items.map((row: { userId: string }) => [row.userId, row]));
      expect(byUser[u1.userId]).toMatchObject({ clocks: 6, onTime: 5, late: 1, noSla: 0, compliancePct: 83.3, avgMin: 135, medianMin: 120, avgPausedMin: 30 });
      expect(byUser[u2.userId]).toMatchObject({ clocks: 1, onTime: 1, late: 0, compliancePct: 100, avgMin: 120 });
    });

    it('SLA per step: the visit as a whole, including returns', async () => {
      const [step] = await get(reader, 'sla/steps', A());
      expect(step).toMatchObject({ stepName: 'task', visits: 6, onTime: 4, late: 2, compliancePct: 66.7, avgMin: 155, medianMin: 120, reprocesses: 1 });
    });

    it('ranking: compliance × quality, quality from the reopening errors', async () => {
      const { ranked, unranked } = await get(reader, 'ranking', `${A()}&minVolume=1`);
      expect(ranked.map((row: { userId: string; rank: number; score: number }) => [row.userId, row.rank, row.score])).toEqual([[u2.userId, 1, 100], [u1.userId, 2, 66.7]]);
      expect(ranked[1]).toMatchObject({ delivered: 5, onTime: 5, late: 1, errors: 1, compliance: expect.closeTo(0.8333, 3), quality: 0.8 });
      expect(unranked).toEqual([]);
      const strict = await get(reader, 'ranking', `${A()}&minVolume=5`);
      expect(strict.ranked.map((row: { userId: string }) => row.userId)).toEqual([u1.userId]);
      expect(strict.unranked.map((row: { userId: string }) => row.userId)).toEqual([u2.userId]);
    });

    it('time distribution per step and per workflow', async () => {
      const { byStep, byWorkflow } = await get(reader, 'time-distribution', A());
      expect(byStep[0]).toMatchObject({ visits: 6, min: 30, median: 120, max: 300 });
      expect(byWorkflow[0]).toMatchObject({ tickets: 5, min: 90, median: 120, max: 300 });
    });

    it('incidents: the pause it caused is the one the engine stored', async () => {
      const report = await get(reader, 'incidents', A());
      expect(report.byStep).toEqual([expect.objectContaining({ count: 1, open: 0, resolved: 1, avgPausedMin: 180, medianPausedMin: 180 })]);
      expect(report.byOpener[0]).toMatchObject({ key: u1.userId, count: 1 });
      expect(report.byAssignee[0]).toMatchObject({ key: u2.userId, count: 1 });
    });

    it('categories: totals per category and per subcategory', async () => {
      const rows = await get(reader, 'categories', A());
      expect(rows).toEqual([
        expect.objectContaining({ subcategoryId: null, created: 6, open: 1, closed: 5, avgResolutionMin: 186 }),
        expect.objectContaining({ subcategoryId: flow.subcategoryId, created: 6, open: 1, closed: 5 }),
      ]);
    });

    it('backlog: the open ticket with its age and overdue clock, as of now', async () => {
      const { rows, asOf } = await get(reader, 'backlog', `companyId=${world.tenant.companyId}`);
      expect(asOf).toBe(bogota('2026-09-08', '09:00').toISOString());
      expect(rows).toEqual([expect.objectContaining({ stepName: 'task', open: 1, paused: 0, overdue: 1, avgAgeDays: 1, maxAgeDays: 1, avgHoursInStep: 24, ageBuckets: [1, 0, 0, 0] })]);
    });

    it('user detail: their summary and their clocks, newest first', async () => {
      const detail = await get(reader, `users/${u1.userId}`, A());
      expect(detail.summary).toMatchObject({ userId: u1.userId, delivered: 5, errors: 1, score: 66.7 });
      expect(detail.clocks.total).toBe(7);
      expect(detail.clocks.items.filter((row: { result: string | null }) => row.result === 'LATE')).toHaveLength(1);
      expect(detail.clocks.items.some((row: { completedAt: string | null }) => row.completedAt === null)).toBe(true);
    });
  });

  describe('time zones and filters', () => {
    it('the period is in the company\'s zone: a ticket created Friday 23:30 in Bogotá belongs to Friday, not to Saturday UTC', async () => {
      const late = await create(bogota('2026-09-11', '23:30'));
      clock.set(REPORT_TIME);
      const friday = await get(reader, 'summary', `from=2026-09-11&to=2026-09-11&companyId=${world.tenant.companyId}`);
      const saturday = await get(reader, 'summary', `from=2026-09-12&to=2026-09-12&companyId=${world.tenant.companyId}`);
      expect([friday.created, saturday.created]).toEqual([1, 0]);
      await db.platform.query(`UPDATE tickets SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`, [world.tenant.tenantId, late.id]);
    });

    it('the filters narrow the numbers: company B has one ticket and one clock', async () => {
      const summary = await get(reader, 'summary', `${PERIOD}&companyId=${companyB}`);
      expect(summary).toMatchObject({ created: 1, closed: 1, avgResolutionMin: 30 });
      expect((await get(reader, 'summary', PERIOD)).created).toBe(7);
      expect((await get(reader, 'summary', `${PERIOD}&workflowId=${flow.workflowId}`)).created).toBe(7);
      expect((await get(reader, 'summary', `${PERIOD}&workflowId=0199a000-0000-7000-8000-0000000000aa`)).created).toBe(0);
    });

    it('validates the filters (400): dates, order, length, ids and injection attempts', async () => {
      for (const query of ['', 'from=2026-09-07', 'from=2026-09-09&to=2026-09-07', 'from=2025-01-01&to=2026-09-07', 'from=2026-13-01&to=2026-09-07', `${PERIOD}&companyId=nope`, `${PERIOD}&companyId=' OR 1=1 --`, `${PERIOD}&extra=1`]) {
        await reader.get(`/reports/summary?${query}`).expect(400);
      }
    });
  });

  describe('scopes run in the database', () => {
    const created = async (conditions: unknown, query = PERIOD) => (await get(await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report', conditions }]), 'summary', query)).created as number;

    it.each([
      ['a company', { companyId: '$A' }, 6],
      ['not a company', { companyId: { not: '$B' } }, 6],
      ['one of several companies', { companyId: { in: ['$B', '0199a000-0000-7000-8000-0000000000aa'] } }, 1],
      ['a workflow', { workflowId: '$W' }, 7],
      ['another workflow', { workflowId: '0199a000-0000-7000-8000-0000000000aa' }, 0],
      ['tickets without a site', { siteId: null }, 7],
      ['tickets with a site', { siteId: { not: null } }, 0],
      ['two conditions at once', { companyId: '$A', workflowId: '$W' }, 6],
    ])('%s', async (_label, conditions, expected) => {
      const resolved = JSON.parse(JSON.stringify(conditions).replace('$A', world.tenant.companyId).replace(/\$B/g, companyB).replace('$W', flow.workflowId));
      expect(await created(resolved)).toBe(expected);
    });

    it('a rule the ability accepts but the compiler cannot read sees nothing (an empty report, not everything)', async () => {
      expect(await created({ companyId: { equals: 'not-a-uuid' } })).toBe(0);
    });

    it('a time limit on the database is a typed error that asks to narrow the filters (422)', async () => {
      const runner = app.get(ReportRunner);
      const ability = { rulesFor: () => [{ conditions: undefined }], can: () => true } as never;
      const slow = app.get(TenantContext).run({ tenantId: world.tenant.tenantId, userId: u1.userId }, () =>
        runner.run(ability, { from: '2026-09-07', to: '2026-09-08' }, async (tx) => {
          await tx.$executeRaw`SELECT set_config('statement_timeout', '30', true)`;
          await tx.$queryRaw`SELECT pg_sleep(1)`;
        }),
      );
      await expect(slow).rejects.toMatchObject({ code: 'REPORT_TIMEOUT' });
    });

    it('pages past the last page still say how many there are, and the name of someone outside the scope is not told', async () => {
      const page = await get(reader, 'sla/responsibles', `${PERIOD}&pageSize=1&page=3`);
      expect(page).toMatchObject({ items: [], page: 3, pageSize: 1, total: 2 });
      const detail = await get(reader, `users/${u1.userId}`, `${PERIOD}&pageSize=1&page=9`);
      expect(detail.clocks).toMatchObject({ items: [], total: 8 });
      const scopedToB = await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report', conditions: { companyId: companyB } }]);
      expect((await get(scopedToB, `users/${u2.userId}`, PERIOD)).name).toBeNull();
      expect((await get(scopedToB, `users/${u1.userId}`, PERIOD)).name).not.toBeNull();
    });
  });

  describe('Excel export', () => {
    const download = async (client: ApiClient, path: string, status = 200) => {
      const response = await client.get(`/reports/${path}`).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(status);
      return response;
    };
    const sheets = async (body: Buffer) => (await readXlsxFile(body as never)) as unknown as Array<{ sheet: string; data: unknown[][] }>;

    it('downloads the report as a workbook with the same numbers and a sheet with the filters', async () => {
      const response = await download(reader, `summary/export?${PERIOD}&companyId=${world.tenant.companyId}`);
      expect(response.headers['content-type']).toContain('spreadsheetml');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['cache-control']).toBe('no-store');
      const book = await sheets(response.body as Buffer);
      expect(book.map((entry) => entry.sheet)).toEqual(['Resumen', 'Filtros']);
      const summary = Object.fromEntries(book[0]!.data.slice(1).map((row) => [row[0], row[1]]));
      expect(summary).toMatchObject({ Creados: 6, Cerrados: 5, Abiertos: 1, '% a tiempo (paso total)': 66.7, '% a tiempo (responsable)': 85.7, 'Tiempo medio de resolución (min hábiles)': 186 });
      expect(book[1]!.data.find((row) => row[0] === 'Empresa')![1]).toBe(world.tenant.companyId);
    });

    it('every report can be exported', async () => {
      for (const name of ['sla-responsibles', 'sla-steps', 'ranking', 'time-distribution', 'incidents', 'categories']) {
        const body = (await download(reader, `${name}/export?${PERIOD}`)).body as Buffer;
        expect((await sheets(body)).length).toBeGreaterThan(1);
      }
      expect((await sheets((await download(reader, 'backlog/export?')).body as Buffer))[0]!.sheet).toBe('Pendientes');
      const user = await download(reader, `user-detail/export?${PERIOD}&userId=${u1.userId}`);
      expect((await sheets(user.body as Buffer)).map((entry) => entry.sheet)).toEqual(['Usuario', 'Relojes del usuario', 'Filtros']);
    });

    it('needs export Report as well as read Report, and applies the narrowest scope of both', async () => {
      const readOnly = await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report' }]);
      await readOnly.get(`/reports/summary/export?${PERIOD}`).expect(403);
      const exportOnly = await clientWith(db, app, world.tenant, [{ action: 'export', subject: 'Report' }]);
      await exportOnly.get(`/reports/summary/export?${PERIOD}`).expect(403);
      const narrowed = await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report' }, { action: 'export', subject: 'Report', conditions: { companyId: companyB } }]);
      const book = await sheets((await download(narrowed, `summary/export?${PERIOD}`)).body as Buffer);
      expect(Object.fromEntries(book[0]!.data.slice(1).map((row) => [row[0], row[1]])).Creados).toBe(1);
    });

    it('refuses an unknown report (400) and bad filters (400)', async () => {
      await reader.get(`/reports/nonsense/export?${PERIOD}`).expect(400);
      await reader.get('/reports/summary/export?from=bad&to=worse').expect(400);
    });

    it('another tenant exports only its own, empty, data', async () => {
      const other = await TicketWorld.create(db, app);
      const otherReader = await clientWith(db, app, other.tenant, [{ action: 'read', subject: 'Report' }, { action: 'export', subject: 'Report' }]);
      const book = await sheets((await download(otherReader, `summary/export?${PERIOD}`)).body as Buffer);
      expect(Object.fromEntries(book[0]!.data.slice(1).map((row) => [row[0], row[1]])).Creados).toBe(0);
    });
  });

  describe('who may see what', () => {
    it('needs read Report', async () => {
      const nobody = await clientWith(db, app, world.tenant, []);
      await nobody.get(`/reports/summary?${PERIOD}`).expect(403);
    });

    it('a permission limited to a company shows only that company, whatever the filters ask for', async () => {
      const scoped = await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report', conditions: { companyId: companyB } }]);
      expect((await get(scoped, 'summary', PERIOD)).created).toBe(1);
      expect((await get(scoped, 'summary', `${PERIOD}&companyId=${world.tenant.companyId}`)).created).toBe(0);
      expect((await get(scoped, 'backlog', '')).rows).toEqual([]);
      const { items } = await get(scoped, 'sla/responsibles', PERIOD);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ userId: u1.userId, clocks: 1 });
      expect((await get(scoped, `users/${u2.userId}`, PERIOD)).clocks.total).toBe(0);
    });

    it('a rule that cannot be understood is dropped, never widened', async () => {
      const broken = await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report', conditions: { status: 'OPEN' } }]);
      await broken.get(`/reports/summary?${PERIOD}`).expect(403);
      const noDepartment = await clientWith(db, app, world.tenant, [{ action: 'read', subject: 'Report', conditions: { departmentId: '${membership.departmentId}' } }]);
      await noDepartment.get(`/reports/summary?${PERIOD}`).expect(403);
    });

    it('a department-limited permission uses the member\'s department', async () => {
      const department = departmentId;
      const roleId = await seedRole(db, world.tenant.tenantId, unique('Role'));
      await setRolePermissions(db, world.tenant.tenantId, roleId, [{ action: 'read', subject: 'Report', conditions: { departmentId: '${membership.departmentId}' } }]);
      const member = await clientOf(db, app, world.tenant, { roleId, departmentId: department });
      expect((await get(member, 'summary', PERIOD)).created).toBe(0);
      await db.platform.query(`UPDATE tickets SET department_id = $1 WHERE tenant_id = $2 AND id = $3`, [department, world.tenant.tenantId, reopenedTicketId]);
      expect((await get(member, 'summary', PERIOD)).created).toBe(1);
      await db.platform.query(`UPDATE tickets SET department_id = NULL WHERE tenant_id = $1 AND id = $2`, [world.tenant.tenantId, reopenedTicketId]);
    });
  });

  describe('another tenant', () => {
    it('sees nothing of this tenant, and this tenant\'s totals do not change when it has data of its own', async () => {
      const other = await TicketWorld.create(db, app);
      const otherReader = await clientWith(db, app, other.tenant, [{ action: 'read', subject: 'Report' }]);
      for (const path of ['summary', 'sla/steps', 'time-distribution', 'incidents', 'categories']) {
        const body = await get(otherReader, path);
        expect(JSON.stringify(body)).not.toContain(world.tenant.tenantId);
      }
      expect((await get(otherReader, 'summary')).created).toBe(0);
      expect((await get(otherReader, 'sla/responsibles')).items).toEqual([]);
      expect((await get(otherReader, 'backlog', '')).rows).toEqual([]);
      const detail = await get(otherReader, `users/${u1.userId}`);
      expect(detail.clocks.total).toBe(0);
      expect(detail.name).toBeNull();
      expect((await get(reader, 'summary', PERIOD)).created).toBe(7);
      expect(openTicketId).toBeDefined();
    });
  });
});
