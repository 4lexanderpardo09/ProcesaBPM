import { emptyDesign, type PdfDesign, type WorkflowVersionDocument } from '@procesabpm/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';
import { at, field, FLOW, id, link, page, START, step } from '../../test/builder-fixtures';

const PUBLISHED = id(21);
const DRAFT = id(22);
const APPROVE = id(32);
const END = id(33);
const FORMAT = id(60);
const TEMPLATE = id(61);
const DOC = id(62);
const COMPANY = id(70);
const FILE_ID = id(90);

const version = (versionId: string, number: number, status: string) => ({ id: versionId, number, status, notes: null, revision: 0, publishedAt: status === 'DRAFT' ? null : at, publishedById: null, createdAt: at });

/** Published: an amount, a table of items and an approval. The draft adds a supplier field. */
const publishedDoc = (): WorkflowVersionDocument => ({
  steps: [step(START, 'START', 'Inicio'), step(APPROVE, 'APPROVAL', 'Aprobar compra'), step(END, 'END', 'Fin')],
  transitions: [link(id(40), START, APPROVE), link(id(41), APPROVE, END)],
  fields: [
    field(id(50), START, 'AMOUNT', 'Monto', 'CURRENCY'),
    field(id(51), START, 'ITEMS', 'Ítems', 'TABLE', {
      config: {
        columns: [
          { code: 'ITEM', label: 'Ítem', type: 'TEXT' },
          { code: 'QTY', label: 'Cantidad', type: 'NUMBER' },
        ],
      },
    }),
  ],
  amountRules: [],
});
const draftDoc = (): WorkflowVersionDocument => ({ ...publishedDoc(), fields: [...publishedDoc().fields, field(id(52), START, 'SUPPLIER', 'Proveedor', 'TEXT')] });

const format = (design: PdfDesign = emptyDesign(), overrides: Record<string, unknown> = {}) => ({ id: FORMAT, workflowId: FLOW, name: 'Orden de compra', description: null, design, fileNamePattern: null, isActive: true, updatedAt: at, warnings: [], ...overrides });
const template = { id: TEMPLATE, workflowId: FLOW, companyId: COMPANY, fileId: FILE_ID, name: 'Formulario del banco', pageCount: 2, hasAcroform: true, acroformFields: [{ name: 'nombre', type: 'TEXT', page: 1 }], isActive: true, updatedAt: at };

/** A fake API with one workflow (published and draft), its format, template and generated document. */
function api(overrides: Record<string, FakeHandler> = {}) {
  let saved = format();
  const handlers: Record<string, FakeHandler> = {
    [`/workflows/${FLOW}`]: () => ({ id: FLOW, subcategoryId: id(11), name: 'Compras', isActive: true, createdAt: at, versions: [version(DRAFT, 2, 'DRAFT'), version(PUBLISHED, 1, 'PUBLISHED')] }),
    [`/workflows/${FLOW}/versions/${PUBLISHED}`]: () => ({ workflow: { id: FLOW, name: 'Compras', subcategoryId: id(11) }, version: version(PUBLISHED, 1, 'PUBLISHED'), document: publishedDoc(), validation: null }),
    [`/workflows/${FLOW}/versions/${DRAFT}`]: () => ({ workflow: { id: FLOW, name: 'Compras', subcategoryId: id(11) }, version: version(DRAFT, 2, 'DRAFT'), document: draftDoc(), validation: null }),
    [`/workflows/${FLOW}/observers`]: () => [],
    '/workflows': () => page([]),
    [`/workflows/${FLOW}/documents`]: (options) => (options.method === 'POST' ? { id: id(63), workflowId: FLOW, companyId: null, kind: 'DESIGNED', formatId: FORMAT, templateId: null, moment: 'EACH_STEP', isActive: true } : page([{ id: DOC, workflowId: FLOW, companyId: COMPANY, kind: 'TEMPLATE', formatId: null, templateId: TEMPLATE, moment: 'CLOSING', isActive: true }])),
    [`/workflows/${FLOW}/documents/${DOC}`]: () => undefined,
    [`/workflows/${FLOW}/pdf-formats`]: (options) => {
      if (options.method === 'POST') {
        saved = format((options.body as { design: PdfDesign }).design, { name: (options.body as { name: string }).name });
        return saved;
      }
      return page([saved]);
    },
    [`/workflows/${FLOW}/pdf-formats/${FORMAT}`]: (options) => {
      if (options.method === 'PATCH') saved = { ...saved, ...(options.body as object), updatedAt: '2026-10-21T16:00:00.000Z' };
      return saved;
    },
    [`/workflows/${FLOW}/pdf-formats/${FORMAT}/preview`]: () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
    [`/workflows/${FLOW}/pdf-templates`]: (options) => (options.method === 'POST' ? template : page([template])),
    [`/workflows/${FLOW}/pdf-templates/${TEMPLATE}`]: () => undefined,
    '/companies': () => page([{ id: COMPANY, name: 'Electrocréditos', taxId: null, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', calendarId: null, isDefault: true, isActive: true, createdAt: at }]),
    '/pdf-templates/uploads': () => ({ uploads: [{ fileId: FILE_ID, url: 'http://storage.test/key', method: 'PUT', headers: { 'content-type': 'application/pdf' }, expiresAt: at }], quota: { overLimit: false } }),
    [`/pdf-templates/uploads/${FILE_ID}/confirm`]: () => ({ id: FILE_ID, name: 'banco.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 4, status: 'CONFIRMED', createdAt: at, confirmedAt: at }),
    ...overrides,
  };
  return handlers;
}

const designerUrl = `/workflows/${FLOW}/formats/${FORMAT}`;

beforeEach(() => {
  // jsdom has no object URLs: the preview frame only needs one.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('PDF documents', () => {
  it('lists the documents a ticket gets, from which source, for which company and when, and adds one', async () => {
    const { fake } = renderRoute(`/workflows/${FLOW}?tab=documents`, { handlers: api() });

    const generated = await screen.findByRole('table', { name: 'Documentos que se generan' });
    const row = (await within(generated).findByText('Formulario del banco')).closest('tr')!;
    expect(within(row).getByText('PDF propio')).toBeInTheDocument();
    expect(await within(row).findByText('Electrocréditos')).toBeInTheDocument();
    expect(within(row).getByText('Al cerrar el ticket')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Agregar documento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agregar documento' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByText('Elige de dónde sale el documento.')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /^Documento/ }), 'Orden de compra (formato)');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /Cuándo se genera/ }), 'Cada vez que avanza');
    expect(within(dialog).getByText(/cada vez queda una versión nueva/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === `/workflows/${FLOW}/documents` && call.options.method === 'POST')?.options.body).toEqual({ formatId: FORMAT, moment: 'EACH_STEP' }));
  });

  it('says why a document a DOCUMENT block asks for cannot be removed', async () => {
    renderRoute(`/workflows/${FLOW}?tab=documents`, {
      handlers: api({
        [`/workflows/${FLOW}/documents/${DOC}`]: () => {
          throw new ApiError({ status: 409, code: 'DOCUMENT_SOURCE_IN_USE', message: 'x' });
        },
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Quitar el documento «Formulario del banco»' }));
    expect(await screen.findByText(/Un bloque Documento del flujo lo pide/)).toBeInTheDocument();
  });

  it('uploads a template through the PDF routes and registers it for a company, and explains a refused PDF', async () => {
    const put = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', put);
    let tries = 0;
    const { fake } = renderRoute(`/workflows/${FLOW}?tab=documents`, {
      handlers: api({
        [`/workflows/${FLOW}/pdf-templates`]: (options) => {
          if (options.method !== 'POST') return page([]);
          tries += 1;
          if (tries === 1) throw new ApiError({ status: 422, code: 'PDF_TEMPLATE_INVALID', message: 'x', details: { reason: 'ENCRYPTED' } });
          return template;
        },
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Subir PDF' }));
    const dialog = await screen.findByRole('dialog', { name: 'Subir un PDF propio' });
    await userEvent.upload(within(dialog).getByLabelText(/Archivo \.pdf/), new File(['%PDF'], 'banco.pdf', { type: 'application/pdf' }));
    expect(within(dialog).getByRole('textbox', { name: /Nombre/ })).toHaveValue('banco');
    await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: /Empresa/ }), 'Electrocréditos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }));
    expect(await within(dialog).findByText(/tiene contraseña o está protegido/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Subir un PDF propio' })).not.toBeInTheDocument());
    expect(fake.callsTo('/pdf-templates/uploads')).toHaveLength(2);
    expect(fake.calls.filter((call) => call.path === `/workflows/${FLOW}/pdf-templates` && call.options.method === 'POST').at(-1)?.options.body).toEqual({ fileId: FILE_ID, name: 'banco', companyId: COMPANY });
  });

  it('creates a format that starts with the ticket number and every field, and opens the designer', async () => {
    const { fake, router } = renderRoute(`/workflows/${FLOW}?tab=documents`, { handlers: api({ [`/workflows/${FLOW}/pdf-formats`]: (options) => (options.method === 'POST' ? format(emptyDesign(), { name: 'Acta' }) : page([])) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo formato' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo formato' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Acta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear y diseñar' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(designerUrl));
    expect(fake.calls.find((call) => call.options.method === 'POST' && call.path.endsWith('/pdf-formats'))?.options.body).toEqual({ name: 'Acta', design: emptyDesign() });
    expect(await screen.findByRole('button', { name: /^1\. Título/ })).toBeInTheDocument();
  });

  it('hides the documents tab from a role that cannot read PDF documents', async () => {
    renderRoute(`/workflows/${FLOW}?tab=documents`, { handlers: { ...api(), '/auth/me/permissions': () => ({ permissions: [{ action: 'read', subject: 'Workflow', conditional: false }] }) } });

    expect(await screen.findByRole('tab', { name: 'Versiones' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Documentos PDF' })).toBeNull();
  });

  describe('designer', () => {
    it('adds a table that starts from the columns of the chosen field, inserts data at the cursor and saves the whole design', async () => {
      const { fake } = renderRoute(designerUrl, { handlers: api() });

      expect(await screen.findByRole('heading', { level: 1, name: 'Orden de compra' })).toBeInTheDocument();
      expect(await screen.findByTitle('Vista previa del PDF')).toHaveAttribute('src', 'blob:preview');
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agregar un bloque a Cuerpo' }), 'Tabla');
      const table = screen.getByRole('region', { name: 'Ajustes de 3. Tabla' });
      expect(within(table).getByText('A este bloque le falta un dato o tiene uno fuera de rango.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
      await userEvent.selectOptions(within(table).getByRole('combobox', { name: 'Campo de tabla' }), 'Ítems');
      expect(within(table).getByRole('textbox', { name: 'Encabezado de la columna 2' })).toHaveValue('Cantidad');
      expect(within(table).getByRole('textbox', { name: 'Valor de la columna 2' })).toHaveValue('{{row.QTY}}');
      await userEvent.click(within(table).getByRole('checkbox', { name: 'Sumar la columna 2 al final' }));

      await userEvent.click(screen.getByRole('button', { name: /^1\. Título/ }));
      const heading = screen.getByRole('region', { name: 'Ajustes de 1. Título' });
      const text = within(heading).getByRole('textbox', { name: 'Texto' });
      await userEvent.clear(text);
      await userEvent.type(text, 'Orden por ');
      await userEvent.selectOptions(within(heading).getByRole('combobox', { name: 'Insertar un dato en «Texto»' }), 'Campo · Monto');
      expect(text).toHaveValue('Orden por {{field.AMOUNT|currency}}');

      expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await vi.waitFor(() => expect(screen.getByText('Todo guardado')).toBeInTheDocument());
      const body = fake.calls.find((call) => call.options.method === 'PATCH')?.options.body as { design: PdfDesign };
      expect(body.design.body).toEqual([
        { type: 'heading', text: 'Orden por {{field.AMOUNT|currency}}', level: 1 },
        { type: 'allFields' },
        {
          type: 'table',
          fieldCode: 'ITEMS',
          columns: [
            { header: 'Ítem', value: '{{row.ITEM}}', width: { fr: 1 } },
            { header: 'Cantidad', value: '{{row.QTY}}', width: { fr: 1 } },
          ],
          repeatHeader: true,
          totals: [{ column: 1 }],
        },
      ]);
      await vi.waitFor(() => expect(fake.callsTo(`/workflows/${FLOW}/pdf-formats/${FORMAT}/preview`)).toHaveLength(2));
    }, 15_000);

    it('does not save a field only the draft has: tickets run on the published version', async () => {
      const design: PdfDesign = { ...emptyDesign(), body: [{ type: 'text', text: '{{field.SUPPLIER}}' }] };
      renderRoute(designerUrl, { handlers: api({ [`/workflows/${FLOW}/pdf-formats/${FORMAT}`]: () => format(design) }) });

      expect(await screen.findByText(/Hay 1 problema que impide guardar/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /^1\. Texto/ }));
      expect(within(screen.getByRole('region', { name: 'Ajustes de 1. Texto' })).getByText('Usa el campo «SUPPLIER», que esta versión del flujo no tiene.')).toBeInTheDocument();
    });

    it('offers the page number only in the header and footer, and asks before leaving with unsaved changes', async () => {
      const { router } = renderRoute(designerUrl, { handlers: api() });

      await userEvent.click(await screen.findByRole('button', { name: /^1\. Título/ }));
      const options = within(screen.getByRole('combobox', { name: 'Insertar un dato en «Texto»' })).getAllByRole('option').map((option) => option.textContent);
      expect(options).toContain('Paso · Quién terminó «Aprobar compra»');
      expect(options).not.toContain('Número de página');

      await userEvent.click(screen.getByRole('checkbox', { name: 'Usar Pie de página' }));
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agregar un bloque a Pie de página' }), 'Texto');
      const footer = within(screen.getByRole('region', { name: 'Ajustes de 1. Texto' })).getByRole('combobox', { name: 'Insertar un dato en «Texto»' });
      expect(within(footer).getAllByRole('option').map((option) => option.textContent)).toContain('Número de página');

      await userEvent.click(screen.getByRole('link', { name: 'Compras' }));
      const confirm = await screen.findByRole('dialog', { name: 'Cambios sin guardar' });
      await userEvent.click(within(confirm).getByRole('button', { name: 'Salir sin guardar' }));
      await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/workflows/${FLOW}`));
    }, 15_000);
  });
});
