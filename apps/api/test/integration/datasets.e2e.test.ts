import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Sheet } from '../../src/infrastructure/spreadsheet/spreadsheet-writer.js';
import { WriteExcelFileWriter } from '../../src/infrastructure/spreadsheet/write-excel-file.writer.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { pdf, uploadFile } from '../support/file-uploads.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, type PublishedFlow, publishFlow, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

const EMPLOYEES: Sheet = {
  name: 'Empleados',
  headers: ['CEDULA', 'NOMBRE', 'CIUDAD'],
  rows: [
    [1234567890, 'Ana Pérez', 'Bogotá'],
    [987654321, 'Luis Gómez', 'Cali'],
    [555, 'Marta Ruiz', 'Bogotá'],
  ],
};

describe('datasets', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let editor: Member;
  let filler: Member;
  let outsider: Member;
  const writer = new WriteExcelFileWriter();

  const xlsx = async (by: Member, sheet: Sheet, name = 'empleados.xlsx') => uploadFile(by, { name, content: await writer.write([sheet]) });
  const createDataset = async (body: Record<string, unknown>, status = 201) => (await editor.client.post('/datasets', { name: unique('Dataset'), ...body }).expect(status)).body;
  const fieldId = async (flow: PublishedFlow, code: string) => (await db.owner.query<{ id: string }>('SELECT id::text FROM fields WHERE version_id = $1 AND code = $2', [flow.versionId, code])).rows[0]!.id;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    editor = await world.member([
      { action: 'read', subject: 'Workflow' },
      { action: 'update', subject: 'Workflow' },
      { action: 'create', subject: 'Ticket' },
    ]);
    filler = await world.member([
      { action: 'create', subject: 'Ticket' },
      { action: 'read_created', subject: 'Ticket' },
    ]);
    outsider = await world.member([{ action: 'read_created', subject: 'Ticket' }]);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('loads the first sheet: headers as columns, every value as text, the key indexed', async () => {
    const dataset = await createDataset({ fileId: await xlsx(editor, EMPLOYEES), keyColumn: 'cedula' });
    expect(dataset).toMatchObject({ keyColumn: 'CEDULA', rowCount: 3, sourceFileName: 'empleados.xlsx', isActive: true, workflowId: null });
    expect(dataset.columns).toEqual([
      { name: 'CEDULA', isKey: true },
      { name: 'NOMBRE', isKey: false },
      { name: 'CIUDAD', isKey: false },
    ]);
    const rows = (await editor.client.get(`/datasets/${dataset.id}/rows`).expect(200)).body;
    expect(rows).toMatchObject({ total: 3, page: 1 });
    expect(rows.items[0]).toEqual({ CEDULA: '1234567890', NOMBRE: 'Ana Pérez', CIUDAD: 'Bogotá' });
    const keys = await db.owner.query<{ lookup_key: string }>('SELECT lookup_key FROM dataset_rows WHERE dataset_id = $1 ORDER BY lookup_key', [dataset.id]);
    expect(keys.rows.map((row) => row.lookup_key)).toEqual(['1234567890', '555', '987654321']);
    expect((await editor.client.get('/datasets').query({ search: dataset.name }).expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual([dataset.id]);
  });

  it('refuses a file that is not a workbook, someone else’s upload and a bad sheet, writing nothing', async () => {
    const before = Number((await db.owner.query<{ n: string }>('SELECT count(*)::text AS n FROM datasets WHERE tenant_id = $1', [world.tenant.tenantId])).rows[0]!.n);
    const notXlsx = await createDataset({ fileId: await uploadFile(editor, { name: 'doc.pdf', content: pdf() }) }, 422);
    expect(notXlsx.error.details).toEqual({ problem: 'NOT_XLSX' });
    await createDataset({ fileId: await xlsx(filler, EMPLOYEES) }, 404);
    const repeated = await createDataset({ fileId: await xlsx(editor, { ...EMPLOYEES, rows: [...EMPLOYEES.rows, [555, 'Otra', 'Cali']] }), keyColumn: 'CEDULA' }, 422);
    expect(repeated.error.details).toEqual({ problem: 'KEY_VALUE_REPEATED', detail: 5 });
    const unknownKey = await createDataset({ fileId: await xlsx(editor, EMPLOYEES), keyColumn: 'EMAIL' }, 422);
    expect(unknownKey.error.details).toEqual({ problem: 'KEY_COLUMN_UNKNOWN', detail: 'EMAIL' });
    const after = Number((await db.owner.query<{ n: string }>('SELECT count(*)::text AS n FROM datasets WHERE tenant_id = $1', [world.tenant.tenantId])).rows[0]!.n);
    expect(after).toBe(before);
  });

  it('refuses a zip bomb before inflating it in memory', async () => {
    // A valid workbook plus one entry of zeros that inflates to 80 MB but compresses to almost nothing.
    const yazl = await import('yazl');
    const zip = new yazl.ZipFile();
    const inner = await import('yauzl');
    const workbook = await writer.write([EMPLOYEES]);
    await new Promise<void>((resolve, reject) =>
      inner.default.fromBuffer(workbook, { lazyEntries: true }, (error, source) => {
        if (error !== null || source === undefined) return reject(error);
        source.on('entry', (entry: import('yauzl').Entry) =>
          source.openReadStream(entry, (streamError, stream) => {
            if (streamError !== null || stream === undefined) return reject(streamError);
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              zip.addBuffer(Buffer.concat(chunks), entry.fileName);
              source.readEntry();
            });
          }),
        );
        source.on('end', () => resolve());
        source.readEntry();
      }),
    );
    zip.addBuffer(Buffer.alloc(80 * 1024 * 1024), 'xl/media/zeros.bin');
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
    const bomb = Buffer.concat(chunks);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const refused = await createDataset({ fileId: await uploadFile(editor, { name: 'bomb.xlsx', content: bomb }) }, 422);
    expect(refused.error.details).toEqual({ problem: 'TOO_LARGE_UNZIPPED' });
  });

  describe('used by a form field', () => {
    let dataset: { id: string };
    let flow: PublishedFlow;
    let cityField: string;
    let nameField: string;

    beforeAll(async () => {
      dataset = await createDataset({ fileId: await xlsx(editor, EMPLOYEES), keyColumn: 'CEDULA' });
      flow = await publishFlow(world.admin, {
        ...simpleFlow(),
        fields: [
          { step: 'start', code: 'CEDULA', type: 'TEXT', capture: 'CREATION' },
          { step: 'start', code: 'NOMBRE', type: 'TEXT', capture: 'CREATION', dataSource: { kind: 'DATASET', datasetId: dataset.id, column: 'NOMBRE', lookupFieldCode: 'CEDULA' } },
          { step: 'start', code: 'CIUDAD', type: 'SELECT', capture: 'CREATION', config: { options: [] }, dataSource: { kind: 'DATASET', datasetId: dataset.id, column: 'CIUDAD' } },
        ],
      });
      cityField = await fieldId(flow, 'CIUDAD');
      nameField = await fieldId(flow, 'NOMBRE');
    });

    it('offers the distinct values of the field column that contain the text, ignoring case', async () => {
      expect((await filler.client.get(`/fields/${cityField}/dataset-options`).expect(200)).body).toEqual({ values: ['Bogotá', 'Cali'] });
      expect((await filler.client.get(`/fields/${cityField}/dataset-options`).query({ q: 'BOG' }).expect(200)).body).toEqual({ values: ['Bogotá'] });
      // `%` is a plain character, not a wildcard.
      expect((await filler.client.get(`/fields/${cityField}/dataset-options`).query({ q: '%' }).expect(200)).body).toEqual({ values: [] });
    });

    it('looks the field value up by the key typed in another field, and only that column', async () => {
      expect((await filler.client.get(`/fields/${nameField}/dataset-lookup`).query({ key: '1234567890' }).expect(200)).body).toEqual({ value: 'Ana Pérez' });
      expect((await filler.client.get(`/fields/${nameField}/dataset-lookup`).query({ key: '000' }).expect(200)).body).toEqual({ value: null });
    });

    it('validates a submitted value against the rows (the number typed as text matches)', async () => {
      const create = (values: Record<string, unknown>) => filler.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Ticket'), values });
      await create({ CEDULA: '1234567890', NOMBRE: 'Ana Pérez', CIUDAD: 'Cali' }).expect(201);
      await create({ CEDULA: '1', NOMBRE: 'Nadie', CIUDAD: 'Cali' }).expect(422);
    });

    it('needs a form-filling permission, and a field without a dataset answers 404', async () => {
      await outsider.client.get(`/fields/${cityField}/dataset-options`).expect(403);
      await filler.client.get(`/fields/${await fieldId(flow, 'CEDULA')}/dataset-options`).expect(404);
    });

    it('a deactivated dataset stops answering the form', async () => {
      await editor.client.patch(`/datasets/${dataset.id}`, { isActive: false }).expect(200);
      await filler.client.get(`/fields/${cityField}/dataset-options`).expect(404);
      await editor.client.patch(`/datasets/${dataset.id}`, { isActive: true }).expect(200);
    });

    it('a reload keeps what the fields read: refused without a used column, replaced otherwise', async () => {
      const withoutCity: Sheet = { name: 'E', headers: ['CEDULA', 'NOMBRE'], rows: [[1, 'Uno']] };
      const refused = (await editor.client.put(`/datasets/${dataset.id}/content`, { fileId: await xlsx(editor, withoutCity) }).expect(409)).body;
      expect(refused.error.details).toEqual({ columns: ['CIUDAD'] });
      const fresh: Sheet = { name: 'E', headers: ['CEDULA', 'NOMBRE', 'CIUDAD', 'EXTRA'], rows: [[42, 'Nuevo', 'Medellín', 'x']] };
      const reloaded = (await editor.client.put(`/datasets/${dataset.id}/content`, { fileId: await xlsx(editor, fresh, 'nuevo.xlsx') }).expect(200)).body;
      expect(reloaded).toMatchObject({ rowCount: 1, keyColumn: 'CEDULA', sourceFileName: 'nuevo.xlsx' });
      expect((await filler.client.get(`/fields/${nameField}/dataset-lookup`).query({ key: '42' }).expect(200)).body).toEqual({ value: 'Nuevo' });
    });

    it('cannot be deleted while a field uses it', async () => {
      await editor.client.delete(`/datasets/${dataset.id}`).expect(409);
    });
  });

  it('deletes an unused dataset with its rows, and audits every change', async () => {
    const dataset = await createDataset({ fileId: await xlsx(editor, EMPLOYEES) });
    await editor.client.patch(`/datasets/${dataset.id}`, { name: unique('Renamed') }).expect(200);
    await editor.client.delete(`/datasets/${dataset.id}`).expect(204);
    await editor.client.get(`/datasets/${dataset.id}`).expect(404);
    expect((await db.owner.query('SELECT 1 FROM dataset_rows WHERE dataset_id = $1', [dataset.id])).rowCount).toBe(0);
    const actions = await db.owner.query<{ action: string }>('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at', [dataset.id]);
    expect(actions.rows.map((row) => row.action)).toEqual(['dataset.created', 'dataset.updated', 'dataset.deleted']);
  });

  it('managing datasets needs the workflow permissions', async () => {
    await filler.client.get('/datasets').expect(403);
    await filler.client.post('/datasets', { name: unique('X'), fileId: await xlsx(filler, EMPLOYEES) }).expect(403);
  });

  it('never shows another tenant’s datasets', async () => {
    const other = await TicketWorld.create(db, app);
    const stranger = await other.member([
      { action: 'read', subject: 'Workflow' },
      { action: 'update', subject: 'Workflow' },
    ]);
    const mine = await createDataset({ fileId: await xlsx(editor, EMPLOYEES) });
    await stranger.client.get(`/datasets/${mine.id}`).expect(404);
    await stranger.client.get(`/datasets/${mine.id}/rows`).expect(404);
    expect((await stranger.client.get('/datasets').expect(200)).body.items).toEqual([]);
  });
});
