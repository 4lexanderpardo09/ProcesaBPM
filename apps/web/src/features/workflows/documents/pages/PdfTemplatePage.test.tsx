import type { TemplateMapping, WorkflowVersionDocument } from '@procesabpm/shared';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';
import { at, field, FLOW, id, link, page, START, step } from '../../test/builder-fixtures';

// jsdom draws nothing: the PDF is a Letter page and a second one, and rendering does nothing.
vi.mock('../lib/pdf-pages', () => ({
  loadPdf: vi.fn(() =>
    Promise.resolve({
      pages: [
        { width: 612, height: 792, box: { mediaBox: { x: 0, y: 0, w: 612, h: 792 }, rotation: 0 } },
        { width: 612, height: 792, box: { mediaBox: { x: 0, y: 0, w: 612, h: 792 }, rotation: 0 } },
      ],
      render: () => Promise.resolve(),
      destroy: () => undefined,
    }),
  ),
}));

const PUBLISHED = id(21);
const APPROVE = id(32);
const END = id(33);
const TEMPLATE = id(61);
const url = `/workflows/${FLOW}/templates/${TEMPLATE}`;
const base = `/workflows/${FLOW}/pdf-templates/${TEMPLATE}`;

const version = { id: PUBLISHED, number: 1, status: 'PUBLISHED', notes: null, revision: 0, publishedAt: at, publishedById: null, createdAt: at };
const doc = (): WorkflowVersionDocument => ({
  steps: [step(START, 'START', 'Inicio'), step(APPROVE, 'APPROVAL', 'Aprobar compra'), step(END, 'END', 'Fin')],
  transitions: [link(id(40), START, APPROVE), link(id(41), APPROVE, END)],
  fields: [field(id(50), START, 'CLIENT', 'Cliente', 'TEXT'), field(id(51), START, 'AMOUNT', 'Monto', 'CURRENCY')],
  amountRules: [],
});
const template = {
  id: TEMPLATE,
  workflowId: FLOW,
  companyId: null,
  fileId: id(90),
  name: 'Formulario del banco',
  pageCount: 2,
  hasAcroform: true,
  acroformFields: [
    { name: 'nombre_cliente', type: 'TEXT', page: 1 },
    { name: 'firma_asesor', type: 'SIGNATURE', page: 2 },
  ],
  isActive: true,
  updatedAt: at,
};

function api(initial: TemplateMapping = { fields: [], signatures: [] }, overrides: Record<string, FakeHandler> = {}) {
  let mapping = initial;
  return {
    [`/workflows/${FLOW}`]: () => ({ id: FLOW, subcategoryId: id(11), name: 'Compras', isActive: true, createdAt: at, versions: [version] }),
    [`/workflows/${FLOW}/versions/${PUBLISHED}`]: () => ({ workflow: { id: FLOW, name: 'Compras', subcategoryId: id(11) }, version, document: doc(), validation: null }),
    [base]: () => template,
    [`${base}/mapping`]: (options) => {
      if (options.method === 'PUT') mapping = options.body as TemplateMapping;
      return { mapping, warnings: [] };
    },
    [`${base}/file/download-url`]: () => ({ url: 'http://storage.test/banco.pdf', expiresAt: at }),
    '/workflows': () => page([]),
    ...overrides,
  } satisfies Record<string, FakeHandler>;
}

/** The drawn page fills 612 × 792 px: one point per pixel, so a click lands where the points say. */
function letterSheet() {
  const sheet = screen.getByLabelText('Página 1 del PDF').parentElement!;
  sheet.getBoundingClientRect = () => ({ left: 0, top: 0, right: 612, bottom: 792, width: 612, height: 792, x: 0, y: 0, toJSON: () => ({}) });
  return sheet;
}

beforeEach(() => {
  // A pane 612 px wide: the page is drawn at one pixel per point.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 612 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  );
});

describe('template mapping', () => {
  it('places a field with a click on the page, puts a text with data into a form field, and saves the whole mapping', async () => {
    const { fake } = renderRoute(url, { handlers: api() });

    expect(await screen.findByRole('heading', { level: 1, name: 'Formulario del banco' })).toBeInTheDocument();
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Agregar dato' }));
    const first = screen.getByRole('group', { name: /Ajustes de Dato 1/ });
    expect(within(first).getByText(/Falta elegir qué se escribe/)).toBeInTheDocument();
    await userEvent.selectOptions(within(first).getByRole('combobox', { name: 'Campo' }), 'Cliente');
    expect(screen.getByText('Haz clic donde va Dato 1: Cliente.')).toBeInTheDocument();
    fireEvent.click(letterSheet(), { clientX: 200, clientY: 792 - 620 });
    expect(within(first).getByRole('textbox', { name: 'Desde la izquierda' })).toHaveValue('200');
    expect(within(first).getByRole('textbox', { name: 'Desde abajo' })).toHaveValue('620');
    expect(screen.getByRole('button', { name: 'Dato 1: Cliente (en la página)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Agregar dato' }));
    const second = screen.getByRole('group', { name: /Ajustes de Dato 2/ });
    await userEvent.selectOptions(within(second).getByRole('combobox', { name: 'Qué se escribe' }), 'Un texto con datos');
    await userEvent.selectOptions(within(second).getByRole('combobox', { name: 'Insertar un dato en «Texto»' }), 'Ticket · Número');
    await userEvent.selectOptions(within(second).getByRole('combobox', { name: 'Dónde va' }), 'En un campo de formulario del PDF');
    const formFields = within(within(second).getByRole('combobox', { name: 'Campo del formulario' })).getAllByRole('option').map((option) => option.textContent);
    expect(formFields).toEqual(['Elige el campo del PDF', 'nombre_cliente (página 1)']);
    await userEvent.selectOptions(within(second).getByRole('combobox', { name: 'Campo del formulario' }), 'nombre_cliente (página 1)');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(screen.getByText('Todo guardado')).toBeInTheDocument());
    expect(fake.callsTo(`${base}/mapping`).find((call) => call.options.method === 'PUT')?.options.body).toEqual({
      fields: [
        { mode: 'COORDINATES', fieldCode: 'CLIENT', page: 1, x: 200, y: 620, fontSize: 10 },
        { mode: 'ACROFORM', expression: '{{ticket.number}}', acroformName: 'nombre_cliente', fontSize: 10 },
      ],
      signatures: [],
    });
  }, 15_000);

  it('offers only signature form fields for a signature, and marks a position off the page and a step that does not exist', async () => {
    renderRoute(url, {
      handlers: api({
        fields: [{ mode: 'COORDINATES', fieldCode: 'AMOUNT', page: 1, x: 700, y: 100 }],
        signatures: [{ mode: 'COORDINATES', stepName: 'Revisar', signerType: 'STEP_ASSIGNEE', page: 1, x: 100, y: 100, width: 150, height: 50 }],
      }),
    });

    expect(await screen.findByText(/Hay 2 problemas que impiden guardar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Dato 1: Monto.*problema/ }));
    expect(within(screen.getByRole('group', { name: /Ajustes de Dato 1/ })).getByText('La posición queda fuera de la página 1.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Firma 1: Revisar.*problema/ }));
    const signature = screen.getByRole('group', { name: /Ajustes de Firma 1/ });
    expect(within(signature).getByText('No hay un paso llamado «Revisar».')).toBeInTheDocument();
    await userEvent.selectOptions(within(signature).getByRole('combobox', { name: 'Dónde va' }), 'En un campo de formulario del PDF');
    expect(within(within(signature).getByRole('combobox', { name: 'Campo del formulario' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['Elige el campo del PDF', 'firma_asesor (página 2)']);
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });
});
