import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { openDownload } from '@/shared/lib/open-download';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';
import { at, DRAFT, END, field, FLOW, id, link, page, START, step, versionOf } from '../../test/builder-fixtures';

vi.mock('@/shared/lib/open-download', () => ({ openDownload: vi.fn() }));

const EXPORT = id(90);
const REVIEW = id(33);
const PAID = id(41);
const document = {
  steps: [step(START, 'START', 'Inicio'), step(REVIEW, 'TASK', 'Tesorería'), step(END, 'END', 'Fin')],
  transitions: [link(id(40), START, REVIEW), link(PAID, REVIEW, END, { type: 'DECISION', label: 'Pagado' })],
  fields: [field(id(70), START, 'DOC', 'Documento', 'TEXT'), field(id(71), START, 'AMOUNT', 'Valor', 'CURRENCY')],
  amountRules: [],
};
const definition = (overrides: Record<string, unknown> = {}) => ({
  id: EXPORT,
  workflowId: FLOW,
  workflowName: 'Viáticos',
  companyId: null,
  name: 'Pagos al banco',
  format: 'CSV',
  sheetName: 'Export',
  delimiter: ';',
  trigger: 'TRANSITION',
  transitionLabel: 'Pagado',
  filter: [],
  mergeBy: null,
  separateBy: null,
  schedule: { cutoffTime: '17:00', frequency: 'WEEKLY', weekdays: [1, 4], monthDay: null, intervalDays: null },
  isActive: true,
  columns: [{ header: 'Documento', sourceType: 'FIELD', sourceRef: 'DOC', format: null }],
  pendingLines: 3,
  lastAutoCutoffAt: null,
  nextCutoffAt: '2026-10-26T22:00:00.000Z',
  createdAt: at,
  ...overrides,
});
const cutoff = (overrides: Record<string, unknown> = {}) => ({
  id: id(95),
  definitionId: EXPORT,
  definitionName: 'Pagos al banco',
  cutoffDate: '2026-10-22',
  generatedAt: at,
  generatedBy: null,
  isManual: true,
  lineCount: 2,
  groupLabel: null,
  responsibleId: null,
  hasFile: true,
  ...overrides,
});

function api(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/exports': (options) => (options.method === 'POST' ? definition({ ...(options.body as object) }) : [definition()]),
    [`/exports/${EXPORT}`]: () => definition(),
    '/workflows': () => page([{ id: FLOW, subcategoryId: id(11), name: 'Viáticos', isActive: true, createdAt: at, subcategory: { id: id(11), name: 'Gastos', category: { id: id(10), name: 'Viajes' } }, publishedVersion: { id: DRAFT, number: 2 }, draftVersion: null }]),
    [`/workflows/${FLOW}`]: () => ({ id: FLOW, subcategoryId: id(11), name: 'Viáticos', isActive: true, createdAt: at, versions: [versionOf('PUBLISHED')] }),
    [`/workflows/${FLOW}/versions/${DRAFT}`]: () => ({ workflow: { id: FLOW, name: 'Viáticos', subcategoryId: id(11) }, version: versionOf('PUBLISHED'), document, validation: null }),
    '/companies': () => page([]),
    ...extra,
  };
}

describe('exports ("planos")', () => {
  it('lists each export with when it writes, when it cuts and what waits', async () => {
    renderRoute('/workflows/exports', { handlers: api() });

    const link = await screen.findByRole('link', { name: 'Pagos al banco' });
    const row = link.closest('tr')!;
    expect(link).toHaveAttribute('href', `/workflows/exports/${EXPORT}`);
    expect(within(row).getByText('Al tomar «Pagado»')).toBeInTheDocument();
    expect(within(row).getByText('Cada lunes y jueves a las 17:00')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
  });

  it('creates an export with its decision, columns and schedule, asking for what is missing first', async () => {
    const { fake, router } = renderRoute('/workflows/exports/new', { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Crear plano' }));
    expect(screen.getByText('Escribe el nombre.')).toBeInTheDocument();
    expect(fake.callsTo('/exports').filter((call) => call.options.method === 'POST')).toHaveLength(0);

    await userEvent.type(screen.getByRole('textbox', { name: /Nombre/ }), 'Pagos al banco');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Flujo/ }), 'Viáticos');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Decisión/ }), 'Pagado');
    const first = screen.getByRole('group', { name: 'Columna 1' });
    await userEvent.type(within(first).getByRole('textbox', { name: 'Encabezado' }), 'Documento');
    await userEvent.selectOptions(within(first).getByRole('combobox', { name: 'Campo' }), 'Documento (DOC)');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar columna' }));
    const second = screen.getByRole('group', { name: 'Columna 2' });
    await userEvent.type(within(second).getByRole('textbox', { name: 'Encabezado' }), 'Fila');
    await userEvent.selectOptions(within(second).getByRole('combobox', { name: 'De dónde sale' }), 'El número de fila');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Frecuencia' }), 'Algunos días de la semana');
    await userEvent.click(screen.getByRole('checkbox', { name: 'viernes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear plano' }));

    await vi.waitFor(() =>
      expect(fake.callsTo('/exports').find((call) => call.options.method === 'POST')?.options.body).toMatchObject({
        workflowId: FLOW,
        name: 'Pagos al banco',
        trigger: 'TRANSITION',
        transitionLabel: 'Pagado',
        columns: [
          { header: 'Documento', sourceType: 'FIELD', sourceRef: 'DOC', format: null },
          { header: 'Fila', sourceType: 'SEQUENCE', sourceRef: null, format: null },
        ],
        schedule: { cutoffTime: '17:00', frequency: 'WEEKLY', weekdays: [5] },
      }),
    );
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/workflows/exports/${EXPORT}`));
  });

  it('generates the files now, says what waits, and downloads one', async () => {
    const { fake } = renderRoute(`/workflows/exports/${EXPORT}?tab=files`, {
      handlers: api({
        [`/exports/${EXPORT}/cutoffs`]: (options) => (options.method === 'POST' ? { cutoffs: [cutoff()], waitingLines: 1 } : [cutoff({ isManual: false })]),
        [`/export-cutoffs/${id(95)}/download-url`]: () => ({ url: 'https://files.example/plano.csv', expiresAt: at }),
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Generar ahora' }));
    expect(await screen.findByText(/Se generó 1 archivo\. 1 línea espera a que su ticket tenga responsable\./)).toBeInTheDocument();
    expect(fake.callsTo(`/exports/${EXPORT}/cutoffs`).some((call) => call.options.method === 'POST')).toBe(true);

    await userEvent.click(await screen.findByRole('button', { name: 'Descargar el archivo del 22/10/2026' }));
    await vi.waitFor(() => expect(openDownload).toHaveBeenCalledWith('https://files.example/plano.csv'));
  });

  it('edits a catalog: a new one by name, its rows, and saves them', async () => {
    const { fake } = renderRoute('/workflows/exports/catalogs', {
      handlers: api({
        '/export-catalogs': () => [],
        '/export-catalogs/BANCOS': (options) => (options.method === 'PUT' ? { catalog: 'BANCOS', ...(options.body as object) } : { catalog: 'BANCOS', entries: [] }),
      }),
    });

    await userEvent.type(await screen.findByRole('textbox', { name: /Catálogo nuevo/ }), 'BANCOS');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar fila' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Lo que dice el ticket' }), 'Bancolombia');
    await userEvent.type(screen.getByRole('textbox', { name: 'Lo que va en el archivo' }), '07');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar catálogo' }));

    await vi.waitFor(() => expect(fake.callsTo('/export-catalogs/BANCOS').find((call) => call.options.method === 'PUT')?.options.body).toEqual({ entries: [{ inputValue: 'Bancolombia', outputValue: '07' }] }));
    expect(await screen.findByText('Catálogo guardado.')).toBeInTheDocument();
  });

  it('shows a person only their own files in "Mis planos"', async () => {
    renderRoute('/my-exports', { handlers: { '/export-cutoffs/mine': () => [cutoff({ responsibleId: id(3), groupLabel: 'Ana Pérez' })] } });
    const table = await screen.findByRole('table', { name: 'Mis planos' });
    expect(await within(table).findByText('Pagos al banco')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Descargar el archivo del 22/10/2026' })).toBeInTheDocument();
  });
});
