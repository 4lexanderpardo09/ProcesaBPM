import { type AnyPdfDesign, emptyCanvasDesign, emptyDesign, type PdfCanvasDesign, type PdfDesign, type WorkflowVersionDocument } from '@procesabpm/shared';
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

const format = (design: AnyPdfDesign = emptyDesign(), overrides: Record<string, unknown> = {}) => ({ id: FORMAT, workflowId: FLOW, name: 'Orden de compra', description: null, design, fileNamePattern: null, isActive: true, updatedAt: at, warnings: [], ...overrides });
const template = { id: TEMPLATE, workflowId: FLOW, companyId: COMPANY, fileId: FILE_ID, name: 'Formulario del banco', pageCount: 2, hasAcroform: true, acroformFields: [{ name: 'nombre', type: 'TEXT', page: 1 }], isActive: true, updatedAt: at };

/** A fake API with one workflow (published and draft), its format, template and generated document. */
function api(overrides: Record<string, FakeHandler> = {}, initial: AnyPdfDesign = emptyDesign()) {
  let saved = format(initial);
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

  it('creates a format on a free canvas by default and opens its designer', async () => {
    const created = (options: { body?: unknown }) => format((options.body as { design: AnyPdfDesign }).design, { name: 'Acta' });
    const { fake, router } = renderRoute(`/workflows/${FLOW}?tab=documents`, { handlers: api({ [`/workflows/${FLOW}/pdf-formats`]: (options) => (options.method === 'POST' ? created(options) : page([])) }, emptyCanvasDesign()) });

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo formato' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo formato' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Acta');
    expect(within(dialog).getByRole('combobox', { name: 'Cómo se diseña' })).toHaveValue('CANVAS');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear y diseñar' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(designerUrl));
    expect(fake.calls.find((call) => call.options.method === 'POST' && call.path.endsWith('/pdf-formats'))?.options.body).toEqual({ name: 'Acta', design: emptyCanvasDesign() });
    expect(await screen.findByRole('button', { name: 'Elemento Título' })).toBeInTheDocument();
  });

  it('creates a format by blocks when asked', async () => {
    const created = (options: { body?: unknown }) => format((options.body as { design: AnyPdfDesign }).design, { name: 'Acta' });
    const { fake } = renderRoute(`/workflows/${FLOW}?tab=documents`, { handlers: api({ [`/workflows/${FLOW}/pdf-formats`]: (options) => (options.method === 'POST' ? created(options) : page([])) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo formato' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo formato' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Acta');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Cómo se diseña' }), 'Por bloques');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear y diseñar' }));

    expect(await screen.findByRole('button', { name: /^1\. Título/ })).toBeInTheDocument();
    expect(fake.calls.find((call) => call.options.method === 'POST' && call.path.endsWith('/pdf-formats'))?.options.body).toEqual({ name: 'Acta', design: emptyDesign() });
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

  describe('canvas designer', () => {
    const canvasPatch = (fake: { calls: ReadonlyArray<{ options: { method?: string; body?: unknown } }> }) => (fake.calls.filter((call) => call.options.method === 'PATCH').at(-1)?.options.body as { design: PdfCanvasDesign }).design;

    it('adds a table of the form with its columns, a total and a calculation, and saves the whole canvas', async () => {
      const { fake } = renderRoute(designerUrl, { handlers: api({}, emptyCanvasDesign()) });

      expect(await screen.findByRole('heading', { level: 1, name: 'Orden de compra' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Elemento Número' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

      await userEvent.click(screen.getByRole('button', { name: 'Tabla' }));
      expect(screen.getByRole('combobox', { name: 'Campo tabla' })).toHaveValue('ITEMS');
      expect(screen.getAllByRole('textbox', { name: 'Encabezado' }).map((box) => (box as HTMLInputElement).value)).toEqual(['Ítem', 'Cantidad']);
      await userEvent.click(screen.getAllByRole('checkbox', { name: 'Sumar en el total' })[1]!);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Fila de total' }));

      // With nothing selected, the page: a calculation that names a field the flow does not have stops the save.
      await userEvent.click(screen.getByRole('application', { name: 'Hoja del formato' }));
      await userEvent.click(screen.getByRole('button', { name: 'Agregar cálculo' }));
      const formula = screen.getByRole('textbox', { name: 'Fórmula' });
      await userEvent.clear(formula);
      await userEvent.type(formula, 'NOPE * 2');
      expect(await screen.findByText(/Una fórmula no es válida/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
      await userEvent.clear(formula);
      await userEvent.type(formula, 'AMOUNT * 2');
      await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Doble');

      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await vi.waitFor(() => expect(screen.getByText('Todo guardado')).toBeInTheDocument());
      const saved = canvasPatch(fake);
      expect(saved.calculations).toEqual([{ code: 'CALC_1', name: 'Doble', formula: 'AMOUNT * 2', decimals: 2 }]);
      expect(saved.elements.map((element) => element.type)).toEqual(['text', 'text', 'table']);
      expect(saved.elements[2]).toMatchObject({ fieldCode: 'ITEMS', showTotals: true, columns: [{ header: 'Ítem', value: '{{row.ITEM}}', sum: false }, { header: 'Cantidad', value: '{{row.QTY}}', sum: true }] });
    }, 20_000);

    it('adds a field as a text with its label and value, moves it with the arrows and undoes it', async () => {
      renderRoute(designerUrl, { handlers: api({}, emptyCanvasDesign()) });

      await userEvent.click(await screen.findByRole('button', { name: 'Agregar «Monto»' }));
      expect(screen.getByRole('textbox', { name: 'Contenido' })).toHaveValue('Monto: {{field.AMOUNT|currency}}');
      const x = () => (screen.getByRole('textbox', { name: 'X (mm)' }) as HTMLInputElement).value;
      const before = Number(x());

      screen.getByRole('button', { name: 'Elemento Monto' }).focus();
      await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowRight}{/Shift}');
      expect(Number(x())).toBeCloseTo(before + 6, 5);
      await userEvent.keyboard('{Control>}z{/Control}');
      expect(Number(x())).toBeCloseTo(before, 5);

      await userEvent.keyboard('{Delete}');
      expect(screen.queryByRole('button', { name: 'Elemento Monto' })).toBeNull();
      await userEvent.keyboard('{Control>}z{/Control}');
      expect(screen.getByRole('button', { name: 'Elemento Monto' })).toBeInTheDocument();
    }, 20_000);

    it('keeps elements on their sheet, and a repeated one on every sheet', async () => {
      const design: PdfCanvasDesign = { ...emptyCanvasDesign(), elements: [{ ...emptyCanvasDesign().elements[0]!, repeat: true }] };
      renderRoute(designerUrl, { handlers: api({}, design) });

      await userEvent.click(await screen.findByRole('button', { name: '+ Hoja' }));
      expect(screen.getByRole('tab', { name: 'Hoja 2' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('button', { name: 'Elemento Título' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Recuadro' }));
      expect(screen.getByRole('button', { name: 'Elemento Recuadro' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'Hoja 1' }));
      expect(screen.queryByRole('button', { name: 'Elemento Recuadro' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Elemento Título' })).toBeInTheDocument();
    });
  });
});
