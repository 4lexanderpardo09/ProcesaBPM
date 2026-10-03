import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../../support/admin-api.js';
import { createTestApp } from '../../support/create-test-app.js';
import { pdf, png, uploadFile } from '../../support/file-uploads.js';
import { useTestEnvironment } from '../../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, simpleFlow, TicketWorld } from '../../support/ticket-world.js';
import { expectStatus } from '../../support/supertest-diagnostics.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not really a zip but starts like one')]);

describe('files on tickets: attachments, FILE fields, comments, closing documents and downloads', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let stranger: Member;
  let flow: PublishedFlow;
  let foreignWorld: TicketWorld;
  let foreigner: Member;

  const create = (extra: Record<string, unknown> = {}, as = requester, target = flow) =>
    as.client.post('/tickets', { subcategoryId: target.subcategoryId, title: 'Request', values: {}, ...extra });
  const documentsOf = async (ticketId: string, as = requester) => (await as.client.get(`/tickets/${ticketId}/documents`).expect(200)).body as Array<{ id: string; role: string; fieldCode: string | null; isCurrent: boolean; eventId: string | null; file: { id: string; name: string; kind: string } }>;
  const fileRow = async (fileId: string) => (await db.platform.query<{ linked_at: Date | null; company_id: string | null }>('SELECT linked_at, company_id FROM stored_files WHERE id = $1', [fileId])).rows[0]!;
  const upload = (as: Member, name: string, content = pdf(name)) => uploadFile(as, { name, content });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member([grant('create'), grant('read_created'), grant('comment')]);
    worker = await world.member([grant('read_assigned'), grant('transition'), grant('close'), grant('comment')]);
    stranger = await world.member([grant('read_created'), grant('comment')]);
    flow = await publishFlow(world.admin, {
      ...simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(worker)] }),
      transitions: [
        { from: 'start', to: 'task', type: 'DEFAULT' },
        { from: 'task', to: 'task', type: 'DECISION', label: 'Again' },
        { from: 'task', to: 'end', type: 'DECISION', label: 'Done' },
      ],
      fields: [
        { step: 'start', code: 'CONTRACT', type: 'FILE', capture: 'CREATION', config: { maxFiles: 2, accept: ['PDF'] } },
        { step: 'task', code: 'RESULT', type: 'FILE', capture: 'STEP', config: { maxFiles: 1 } },
      ],
    });
    foreignWorld = await TicketWorld.create(db, app);
    foreigner = await foreignWorld.member([grant('create'), grant('read_created'), grant('comment')]);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('creating a ticket with files', () => {
    it('links loose attachments and FILE field values to the CREATED event, and marks the uploads as linked', async () => {
      const [loose, contract] = [await upload(requester, 'brief.pdf'), await upload(requester, 'contract.pdf')];
      const created = await create({ attachments: [loose], values: { CONTRACT: [contract] } });
      expectStatus(created, 201);
      const documents = await documentsOf(created.body.id);
      expect(documents.map((document) => [document.file.id, document.role, document.fieldCode, document.isCurrent])).toEqual(
        expect.arrayContaining([
          [loose, 'ATTACHMENT', null, true],
          [contract, 'ATTACHMENT', 'CONTRACT', true],
        ]),
      );
      const createdEvent = (await world.events(created.body.id)).find((event) => event.type === 'CREATED');
      expect(createdEvent).toBeDefined();
      expect(new Set(documents.map((document) => document.eventId)).size).toBe(1);
      expect((await fileRow(loose)).linked_at).not.toBeNull();
      expect((await fileRow(loose)).company_id).toBe(world.tenant.companyId);
      const detail = (await requester.client.get(`/tickets/${created.body.id}`).expect(200)).body;
      expect(detail.values.CONTRACT).toEqual([contract]);
    });

    it('refuses an upload that was already attached to another ticket', async () => {
      const file = await upload(requester, 'once.pdf');
      await create({ attachments: [file] }).then((response) => expectStatus(response, 201));
      const again = await create({ attachments: [file] });
      expectStatus(again, 422);
      expect(again.body.error).toMatchObject({ code: 'ATTACHMENTS_INVALID', details: { issues: [{ fileId: file, code: 'FILE_NOT_ATTACHABLE' }] } });
    });

    it('refuses the same upload in a FILE field after it was attached', async () => {
      const file = await upload(requester, 'twice.pdf');
      await create({ attachments: [file] }).then((response) => expectStatus(response, 201));
      const again = await create({ values: { CONTRACT: [file] } });
      expectStatus(again, 422);
      expect(again.body.error.details.issues).toEqual([{ code: 'FILE_NOT_ATTACHABLE', fieldCode: 'CONTRACT' }]);
    });

    it("refuses somebody else's upload, one that is not confirmed and one that does not exist", async () => {
      const theirs = await upload(worker, 'theirs.pdf');
      const reserved = (await requester.client.post('/files/uploads', { files: [{ name: 'p.pdf', sizeBytes: 5, sha256: 'a'.repeat(64) }] }).expect(201)).body.uploads[0].fileId as string;
      for (const id of [theirs, reserved, '0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90']) {
        const response = await create({ attachments: [id] });
        expect(response.status, id).toBe(422);
        expect(response.body.error.code).toBe('ATTACHMENTS_INVALID');
      }
      expect((await fileRow(theirs)).linked_at).toBeNull();
    });

    it('refuses what the field does not accept or allow, and requires what it marks as required', async () => {
      const image = await upload(requester, 'photo.png', png());
      const [a, b, c] = [await upload(requester, 'a.pdf'), await upload(requester, 'b.pdf'), await upload(requester, 'c.pdf')];
      const wrongKind = await create({ values: { CONTRACT: [image] } });
      expect(wrongKind.body.error.details.issues).toEqual([{ code: 'FILE_TYPE_NOT_ACCEPTED', fieldCode: 'CONTRACT' }]);
      const tooMany = await create({ values: { CONTRACT: [a, b, c] } });
      expect(tooMany.body.error.details.issues).toEqual([{ code: 'TOO_MANY_FILES', fieldCode: 'CONTRACT' }]);
      expect((await create({ values: { CONTRACT: 'not a list' } })).status).toBe(422);
    });

    it('enforces the 15 files per submission limit across fields and attachments', async () => {
      const ids: string[] = [];
      for (let index = 0; index < 16; index += 1) ids.push(await upload(requester, `n${index}.pdf`));
      expect((await create({ attachments: ids })).status).toBe(400);
      const response = await create({ attachments: ids.slice(0, 15) });
      expectStatus(response, 201);
    });

    it('lets only one of two parallel submissions of the same upload win', async () => {
      const file = await upload(requester, 'race.pdf');
      const results = await Promise.all([create({ attachments: [file] }), create({ attachments: [file] })]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 422]);
      expect((await db.platform.query('SELECT 1 FROM ticket_documents WHERE file_id = $1', [file])).rowCount).toBe(1);
    });

    it('creates nothing when an attachment is refused: no ticket, no document, the other uploads stay free', async () => {
      const good = await upload(requester, 'good.pdf');
      const tickets = (await db.platform.query('SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1', [world.tenant.tenantId])).rows[0].n;
      await create({ attachments: [good, '0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90'] }).then((response) => expectStatus(response, 422));
      expect((await db.platform.query('SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1', [world.tenant.tenantId])).rows[0].n).toBe(tickets);
      expect((await fileRow(good)).linked_at).toBeNull();
    });
  });

  describe('advancing, commenting and closing', () => {
    let ticketId: string;
    let visitId: string;

    beforeAll(async () => {
      const created = await create();
      ticketId = created.body.id;
      visitId = created.body.openVisitId;
    });

    it('a FILE field replaced at a step keeps the old file in the history and makes the new one current', async () => {
      const [first, second] = [await upload(worker, 'first.pdf'), await upload(worker, 'second.pdf')];
      const again = flow.transition.Again!;
      const moved = await worker.client.post(`/tickets/${ticketId}/transition`, { transitionId: again, visitId, values: { RESULT: [first] } }).expect(200);
      const replaced = await worker.client.post(`/tickets/${ticketId}/transition`, { transitionId: again, visitId: moved.body.openVisitId, values: { RESULT: [second] } }).expect(200);
      visitId = replaced.body.openVisitId;
      const documents = (await documentsOf(ticketId)).filter((document) => document.fieldCode === 'RESULT');
      expect(documents.map((document) => [document.file.id, document.isCurrent])).toEqual([
        [first, false],
        [second, true],
      ]);
    });

    it('attachments of a transition are linked to its TRANSITIONED event', async () => {
      const note = await upload(worker, 'note.pdf');
      const moved = await worker.client.post(`/tickets/${ticketId}/transition`, { transitionId: flow.transition.Again!, visitId, values: {}, attachments: [note] }).expect(200);
      visitId = moved.body.openVisitId;
      const linked = (await documentsOf(ticketId)).find((document) => document.file.id === note)!;
      const event = (await db.platform.query<{ type: string }>('SELECT type FROM ticket_events WHERE id = $1', [linked.eventId])).rows[0]!;
      expect(event.type).toBe('TRANSITIONED');
    });

    it('a comment can carry files, and a comment needs the permission and the right to see the ticket', async () => {
      const file = await upload(requester, 'evidence.pdf');
      const response = await requester.client.post(`/tickets/${ticketId}/comments`, { comment: '<p>See attached</p><script>x()</script>', attachments: [file] }).expect(201);
      const event = (await db.platform.query<{ type: string; comment_html: string }>('SELECT type, comment_html FROM ticket_events WHERE id = $1', [response.body.eventId])).rows[0]!;
      expect(event).toEqual({ type: 'COMMENTED', comment_html: '<p>See attached</p>' });
      expect((await documentsOf(ticketId)).find((document) => document.file.id === file)!.eventId).toBe(response.body.eventId);
      expect((await world.outbox('ticket.commented', ticketId)).length).toBeGreaterThan(0);

      await stranger.client.post(`/tickets/${ticketId}/comments`, { comment: 'hi' }).expect(404);
      const reader = await world.member([grant('read_created')]);
      await reader.client.post(`/tickets/${ticketId}/comments`, { comment: 'hi' }).expect(403);
      await requester.client.post(`/tickets/${ticketId}/comments`, { comment: '   ' }).expect(400);
      await requester.client.post(`/tickets/${ticketId}/comments`, { comment: '<script>x()</script>' }).expect(422);
    });

    it('refuses to attach to a comment what somebody else uploaded', async () => {
      const theirs = await upload(worker, 'theirs.pdf');
      const response = await requester.client.post(`/tickets/${ticketId}/comments`, { comment: 'mine', attachments: [theirs] });
      expectStatus(response, 422);
      expect(response.body.error.code).toBe('ATTACHMENTS_INVALID');
      expect((await fileRow(theirs)).linked_at).toBeNull();
    });

    it('closing documents get the CLOSING role, and comments are still allowed on the closed ticket', async () => {
      const closing = await upload(worker, 'closing.pdf');
      await worker.client.post(`/tickets/${ticketId}/transition`, { transitionId: flow.transition.Done!, visitId, values: {}, attachments: [closing] }).expect(200);
      expect((await world.ticketRow(ticketId)).status).toBe('CLOSED');
      const late = await upload(requester, 'late.pdf');
      await requester.client.post(`/tickets/${ticketId}/comments`, { comment: 'thanks', attachments: [late] }).expect(201);
      expect((await documentsOf(ticketId)).some((document) => document.file.id === late)).toBe(true);
    });

    it('a ticket closed with the close action stores its documents as CLOSING', async () => {
      const closeFlow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', closeRule: 'ALLOWED' }, { candidates: [user(worker)] }));
      const created = await create({}, requester, closeFlow);
      const document = await upload(worker, 'closing-doc.pdf');
      await worker.client.post(`/tickets/${created.body.id}/close`, { visitId: created.body.openVisitId, values: {}, attachments: [document] }).expect(200);
      expect((await documentsOf(created.body.id)).find((entry) => entry.file.id === document)!.role).toBe('CLOSING');
    });
  });

  describe('listing and downloading', () => {
    let ticketId: string;
    let otherTicketId: string;
    let pdfId: string;
    let zipId: string;
    const content = pdf('download me');

    beforeAll(async () => {
      pdfId = await uploadFile(requester, { name: 'report.pdf', content });
      zipId = await upload(requester, 'bundle.zip', ZIP);
      ticketId = (await create({ attachments: [pdfId, zipId] })).body.id;
      otherTicketId = (await create({ attachments: [await upload(requester, 'other.pdf')] })).body.id;
    });

    it('serves the exact bytes through a short-lived signed URL, inline for PDFs', async () => {
      const response = await requester.client.get(`/tickets/${ticketId}/files/${pdfId}/download-url`).expect(200);
      const lifetime = new Date(response.body.expiresAt).getTime() - Date.now();
      expect(lifetime).toBeGreaterThan(0);
      expect(lifetime).toBeLessThanOrEqual(120_000);
      const download = await fetch(response.body.url);
      expectStatus(download, 200);
      expect(Buffer.from(await download.arrayBuffer()).equals(content)).toBe(true);
      expect(download.headers.get('content-disposition')).toMatch(/^inline; filename="report\.pdf"/);
      expect(download.headers.get('content-type')).toBe('application/pdf');
    });

    it('makes everything else a download, never a page', async () => {
      const response = await requester.client.get(`/tickets/${ticketId}/files/${zipId}/download-url`).expect(200);
      expect((await fetch(response.body.url)).headers.get('content-disposition')).toMatch(/^attachment; filename="bundle\.zip"/);
    });

    it('lists the documents with their kind and name', async () => {
      const documents = await documentsOf(ticketId);
      expect(documents.map((document) => [document.file.name, document.file.kind])).toEqual([['report.pdf', 'PDF'], ['bundle.zip', 'ZIP']]);
    });

    it('whoever cannot read the ticket gets 404 for the list and for every download, like for a missing ticket', async () => {
      await stranger.client.get(`/tickets/${ticketId}/documents`).expect(404);
      await stranger.client.get(`/tickets/${ticketId}/files/${pdfId}/download-url`).expect(404);
      await requester.client.get('/tickets/0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90/documents').expect(404);
    });

    it("a file of one ticket is not downloadable through another ticket, even the caller's own", async () => {
      await requester.client.get(`/tickets/${otherTicketId}/files/${pdfId}/download-url`).expect(404);
      await requester.client.get(`/tickets/${ticketId}/files/0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90/download-url`).expect(404);
    });

    it('an unlinked upload cannot be downloaded through a ticket', async () => {
      const loose = await upload(requester, 'loose.pdf');
      await requester.client.get(`/tickets/${ticketId}/files/${loose}/download-url`).expect(404);
    });

    it('an assignee reads the ticket, so the files, only once the ticket is assigned to them', async () => {
      await worker.client.get(`/tickets/${ticketId}/documents`).expect(200);
      await worker.client.get(`/tickets/${ticketId}/files/${pdfId}/download-url`).expect(200);
    });
  });

  describe('tenant isolation', () => {
    let ticketId: string;
    let fileId: string;

    beforeAll(async () => {
      fileId = await upload(requester, 'ours.pdf');
      ticketId = (await create({ attachments: [fileId] })).body.id;
    });

    it("another tenant sees neither the documents nor a download of this tenant's ticket", async () => {
      await foreigner.client.get(`/tickets/${ticketId}/documents`).expect(404);
      await foreigner.client.get(`/tickets/${ticketId}/files/${fileId}/download-url`).expect(404);
      await foreignWorld.admin.get(`/tickets/${ticketId}/documents`).expect(404);
    });

    it("another tenant cannot comment on this tenant's ticket", async () => {
      await foreigner.client.post(`/tickets/${ticketId}/comments`, { comment: 'hello' }).expect(404);
      await foreignWorld.admin.post(`/tickets/${ticketId}/comments`, { comment: 'hello' }).expect(404);
      expect((await world.events(ticketId)).some((event) => event.type === 'COMMENTED')).toBe(false);
    });

    it("another tenant's upload cannot be attached here, in any place, and stays unlinked", async () => {
      const foreign = await upload(foreigner, 'foreign.pdf');
      const asAttachment = await create({ attachments: [foreign] });
      expect(asAttachment.body.error.code).toBe('ATTACHMENTS_INVALID');
      const asField = await create({ values: { CONTRACT: [foreign] } });
      expect(asField.body.error.details.issues).toEqual([{ code: 'FILE_NOT_ATTACHABLE', fieldCode: 'CONTRACT' }]);
      const asComment = await requester.client.post(`/tickets/${ticketId}/comments`, { comment: 'hi', attachments: [foreign] });
      expect(asComment.body.error.code).toBe('ATTACHMENTS_INVALID');
      expect((await fileRow(foreign)).linked_at).toBeNull();
    });

    it('a document row can never point at a file of another tenant', async () => {
      const foreign = await upload(foreigner, 'fk.pdf');
      const attach = db.platform.query(`INSERT INTO ticket_documents (tenant_id, ticket_id, file_id, role) VALUES ($1, $2, $3, 'ATTACHMENT')`, [world.tenant.tenantId, ticketId, foreign]);
      await expect(attach).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23514)$/) });
    });
  });
});
