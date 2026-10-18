import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { ticketCountsResponseSchema } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const READS = ['read_created', 'read_assigned', 'read_observed'].map(grant);

interface CreatedTicket {
  readonly id: string;
  readonly number: string;
  readonly openVisitId: string;
}

interface Page {
  readonly items: ReadonlyArray<{ id: string }>;
  readonly total: number;
}

describe('GET /tickets filters and GET /tickets/counts', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let flowA: PublishedFlow;
  let flowB: PublishedFlow;
  let categoryA: string;
  let categoryB: string;
  let companyB: string;
  let priority: string;
  let requester: Member;
  let colleague: Member;
  let reader: Member;
  let stranger: Member;
  let observer: Member;
  const ticket = {} as Record<'percent' | 'plain' | 'underscore' | 'noUnderscore' | 'colleague', CreatedTicket>;

  const list = async (member: Member, query: string): Promise<Page> => (await member.client.get(`/tickets?pageSize=100&${query}`).expect(200)).body as Page;
  const ids = async (member: Member, query: string) => (await list(member, query)).items.map((item) => item.id).sort();
  const idsOf = (...names: Array<keyof typeof ticket>) => names.map((name) => ticket[name].id).sort();
  const counts = async (member: Member, query = '') => ticketCountsResponseSchema.parse((await member.client.get(`/tickets/counts?${query}`).expect(200)).body);

  const categoryOf = async (flow: PublishedFlow) => (await db.platform.query<{ category_id: string }>(`SELECT category_id FROM subcategories WHERE id = $1`, [flow.subcategoryId])).rows[0]!.category_id;
  const rename = (member: Member, firstName: string, lastName: string) => db.platform.query(`UPDATE users SET first_name = $1, last_name = $2 WHERE id = $3`, [firstName, lastName, member.userId]);
  const create = async (member: Member, flow: PublishedFlow, title: string, extra: Record<string, unknown> = {}): Promise<CreatedTicket> =>
    (await member.client.post('/tickets', { subcategoryId: flow.subcategoryId, title, values: {}, ...extra }).expect(201)).body as CreatedTicket;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    // The default task step goes to the creator: their tickets are in both "created" and "assigned".
    [flowA, flowB] = [await publishFlow(world.admin, simpleFlow()), await publishFlow(world.admin, simpleFlow())];
    [categoryA, categoryB] = [await categoryOf(flowA), await categoryOf(flowB)];
    companyB = (await world.admin.post('/companies', { name: unique('Company B'), countryCode: 'CO' }).expect(201)).body.id as string;
    priority = (await world.admin.post('/priorities', { name: unique('Urgent') }).expect(201)).body.id as string;

    requester = await world.member([grant('create'), grant('transition'), ...READS]);
    colleague = await world.member([grant('create'), ...READS]);
    reader = await world.member([grant('read_all')]);
    stranger = await world.member(READS);
    observer = await world.member([grant('read_observed')]);
    await rename(requester, 'Zoe María', 'Quintero');
    await rename(colleague, 'Bruno', 'Díaz');
    await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, requester.userId, companyB]);
    await world.admin.post(`/workflows/${flowB.workflowId}/observers`, { participantType: 'USER', userId: observer.userId }).expect(201);

    const main = world.tenant.companyId;
    ticket.percent = await create(requester, flowA, 'Printer 100% broken', { priorityId: priority, companyId: main });
    ticket.plain = await create(requester, flowA, 'Printer 100 broken', { companyId: main });
    ticket.underscore = await create(requester, flowB, 'Rename snake_case field', { companyId: companyB });
    ticket.noUnderscore = await create(requester, flowB, 'Rename snakeXcase field', { companyId: main });
    ticket.colleague = await create(colleague, flowA, 'Network down');
    await requester.client.post(`/tickets/${ticket.plain.id}/transition`, { visitId: ticket.plain.openVisitId, transitionId: flowA.transition.Done }).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('search', () => {
    it('by ticket number, with or without "#" (no title here has these digits)', async () => {
      expect(await ids(reader, `view=all&search=${ticket.underscore.number}`)).toEqual(idsOf('underscore'));
      expect(await ids(reader, `view=all&search=${encodeURIComponent(`#${ticket.colleague.number}`)}`)).toEqual(idsOf('colleague'));
    });

    it('by title, ignoring case', async () => {
      expect(await ids(reader, 'view=all&search=PRINTER')).toEqual(idsOf('percent', 'plain'));
    });

    it('treats % and _ as plain characters, not wildcards', async () => {
      expect(await ids(reader, `view=all&search=${encodeURIComponent('100%')}`)).toEqual(idsOf('percent'));
      expect(await ids(reader, 'view=all&search=e_c')).toEqual(idsOf('underscore'));
      expect(await ids(reader, `view=all&search=${encodeURIComponent('%')}`)).toEqual(idsOf('percent'));
      expect(await ids(reader, `view=all&search=${encodeURIComponent('\\')}`)).toEqual([]);
    });

    it('by the requester\'s name: every word in the first or last name, ignoring case', async () => {
      expect(await ids(reader, `view=all&search=${encodeURIComponent('zoe quintero')}`)).toEqual(idsOf('percent', 'plain', 'underscore', 'noUnderscore'));
      expect(await ids(reader, 'view=all&search=bruno')).toEqual(idsOf('colleague'));
      expect(await ids(reader, `view=all&search=${encodeURIComponent('zoe díaz')}`)).toEqual([]);
    });

    it('never shows what the caller cannot read, whatever it matches', async () => {
      expect((await list(stranger, 'view=all&search=zoe')).total).toBe(0);
      expect((await list(stranger, `view=all&search=${ticket.percent.number}`)).total).toBe(0);
      expect(await ids(colleague, 'view=all&search=printer')).toEqual([]);
    });
  });

  describe('filters', () => {
    it('by priority', async () => {
      expect(await ids(reader, `view=all&priorityId=${priority}`)).toEqual(idsOf('percent'));
    });

    it('by category: the tickets whose subcategory belongs to it', async () => {
      expect(await ids(reader, `view=all&categoryId=${categoryB}`)).toEqual(idsOf('underscore', 'noUnderscore'));
    });

    it('by company', async () => {
      expect(await ids(reader, `view=all&companyId=${companyB}`)).toEqual(idsOf('underscore'));
    });

    it('compose with each other, with the status and with the view', async () => {
      expect(await ids(reader, `view=all&categoryId=${categoryB}&search=rename&companyId=${world.tenant.companyId}`)).toEqual(idsOf('noUnderscore'));
      expect(await ids(requester, 'view=created&status=CLOSED&search=printer')).toEqual(idsOf('plain'));
      expect(await ids(requester, 'view=assigned&search=printer')).toEqual(idsOf('percent'));
      expect(await ids(reader, 'view=created&search=printer')).toEqual([]);
      expect(await ids(observer, `view=observed&search=rename`)).toEqual(idsOf('underscore', 'noUnderscore'));
      expect(await ids(observer, `view=observed&categoryId=${categoryB}&companyId=${companyB}`)).toEqual(idsOf('underscore'));
    });

    it('never widen what the caller can read: a filter on another\'s tickets finds nothing', async () => {
      expect((await list(stranger, `view=all&categoryId=${categoryB}`)).total).toBe(0);
      expect((await list(stranger, `view=all&priorityId=${priority}`)).total).toBe(0);
      expect((await list(observer, `view=all&categoryId=${categoryA}`)).total).toBe(0);
    });
  });

  describe('GET /tickets/counts', () => {
    const views = ['assigned', 'created', 'observed', 'all'] as const;

    it('matches the listing\'s total of every view under the same filters', async () => {
      for (const [member, query] of [
        [requester, ''],
        [requester, 'search=printer'],
        [requester, `status=OPEN&categoryId=${categoryB}`],
        [reader, `companyId=${world.tenant.companyId}`],
        [reader, `priorityId=${priority}`],
        [observer, 'search=rename'],
        [stranger, ''],
      ] as const) {
        const answer = await counts(member, query);
        for (const view of views) expect(answer[view], `${view} ${query}`).toBe((await list(member, `view=${view}&${query}`)).total);
      }
    });

    it('counts each view for its caller', async () => {
      expect(await counts(requester)).toEqual({ assigned: 3, created: 4, observed: 0, all: 4 });
      expect(await counts(observer)).toEqual({ assigned: 0, created: 0, observed: 2, all: 2 });
      expect(await counts(stranger)).toEqual({ assigned: 0, created: 0, observed: 0, all: 0 });
    });

    it('needs a permission to read tickets (403)', async () => {
      const onlyCreates = await world.member([grant('create')]);
      expect((await onlyCreates.client.get('/tickets/counts')).status).toBe(403);
    });

    it('never counts another tenant\'s tickets', async () => {
      const foreign = await TicketWorld.create(db, app);
      const foreignFlow = await publishFlow(foreign.admin, simpleFlow());
      await foreign.admin.post('/tickets', { subcategoryId: foreignFlow.subcategoryId, title: 'Printer 100% broken', values: {} }).expect(201);
      expect((await counts(reader, 'search=printer')).all).toBe(2);
      expect((await world.admin.get('/tickets?view=all&search=printer').expect(200)).body.total).toBe(2);
      expect((await foreign.admin.get('/tickets/counts?search=printer').expect(200)).body.all).toBe(1);
    });
  });

  describe('validation (400)', () => {
    it.each([
      ['a search longer than 100 characters', `search=${'a'.repeat(101)}`],
      ['an empty search', 'search=%20%20'],
      ['a priority that is not an id', 'priorityId=urgent'],
      ['a category that is not an id', 'categoryId=1'],
      ['a company that is not an id', 'companyId=x'],
      ['an unknown status', 'status=DONE'],
    ])('rejects %s, on the listing and on the counts', async (_, query) => {
      expect((await reader.client.get(`/tickets?${query}`)).status).toBe(400);
      expect((await reader.client.get(`/tickets/counts?${query}`)).status).toBe(400);
    });
  });
});
