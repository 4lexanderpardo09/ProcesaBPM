import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const FLOW = id(20);
const CLIENTS = id(30);
const BANKS = id(31);
const FILE_ID = id(90);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const page = <T,>(items: readonly T[], total = items.length) => ({ items, page: 1, pageSize: 100, total });
const dataset = (overrides: Record<string, unknown> = {}) => ({
  id: CLIENTS,
  name: 'Clientes',
  workflowId: null,
  columns: [
    { name: 'Cédula', isKey: true },
    { name: 'Nombre', isKey: false },
  ],
  keyColumn: 'Cédula',
  rowCount: 2,
  sourceFileName: 'clientes.xlsx',
  loadedAt: at,
  isActive: true,
  ...overrides,
});
const workflowItem = {
  id: FLOW,
  subcategoryId: id(11),
  name: 'Confirmación de pagos',
  isActive: true,
  createdAt: at,
  subcategory: { id: id(11), name: 'Pagos', category: { id: id(10), name: 'Cartera' } },
  publishedVersion: null,
  draftVersion: null,
};
const slot = { fileId: FILE_ID, url: 'http://storage.test/bucket/key?sig=1', method: 'PUT', headers: { 'content-type': XLSX_MIME }, expiresAt: at };
const stored = { id: FILE_ID, name: 'bancos.xlsx', kind: 'OFFICE', mimeType: XLSX_MIME, sizeBytes: 4, status: 'CONFIRMED', createdAt: at, confirmedAt: at };
const xlsx = (name: string) => new File(['PK..'], name, { type: XLSX_MIME });

/** A fake API with one dataset that keeps its changes in memory. */
function api(overrides: Record<string, FakeHandler> = {}) {
  let clients = dataset();
  const handlers: Record<string, FakeHandler> = {
    '/workflows': () => page([workflowItem]),
    '/datasets': () => page([clients, dataset({ id: BANKS, name: 'Bancos', workflowId: FLOW, columns: [{ name: 'Banco', isKey: false }], keyColumn: null, rowCount: 12_500 })]),
    [`/datasets/${CLIENTS}`]: (options) => {
      if (options.method === 'PATCH') clients = { ...clients, ...(options.body as object) };
      return clients;
    },
    [`/datasets/${CLIENTS}/rows`]: () =>
      page([
        { Cédula: '1010', Nombre: 'Ana Ruiz' },
        { Cédula: '2020', Nombre: 'Luis Gómez' },
      ]),
    '/datasets/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }),
    [`/datasets/uploads/${FILE_ID}/confirm`]: () => stored,
    ...overrides,
  };
  return handlers;
}

afterEach(() => vi.unstubAllGlobals());

describe('datasets', () => {
  it('is reached from the workflows list and lists each Excel with who may use it', async () => {
    const { router } = renderRoute('/workflows', { handlers: api() });

    await userEvent.click(await screen.findByRole('link', { name: 'Datos de Excel' }));
    expect(router.state.location.pathname).toBe('/workflows/datasets');
    const table = await screen.findByRole('table', { name: 'Datos de Excel' });
    const clients = (await within(table).findByRole('link', { name: 'Clientes' })).closest('tr')!;
    expect(within(clients).getByText('Todos los flujos')).toBeInTheDocument();
    const banks = within(table).getByRole('link', { name: 'Bancos' }).closest('tr')!;
    expect(await within(banks).findByText('Confirmación de pagos')).toBeInTheDocument();
    expect(within(banks).getByText('12.500')).toBeInTheDocument();
  });

  it('loads a new Excel for one workflow, then reads the same upload again with the key column chosen from what it found', async () => {
    const put = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', put);
    const loaded = dataset({ id: BANKS, name: 'bancos', workflowId: FLOW, keyColumn: null, columns: [{ name: 'Código', isKey: false }, { name: 'Banco', isKey: false }], rowCount: 3 });
    let keyTries = 0;
    const { fake, router } = renderRoute('/workflows/datasets', {
      handlers: api({
        '/datasets': (options) => (options.method === 'POST' ? loaded : page([])),
        [`/datasets/${BANKS}/content`]: (options) => {
          keyTries += 1;
          if (keyTries === 1) throw new ApiError({ status: 422, code: 'DATASET_FILE_INVALID', message: 'x', details: { problem: 'KEY_VALUE_REPEATED', detail: 4 } });
          return { ...loaded, keyColumn: (options.body as { keyColumn: string }).keyColumn, columns: [{ name: 'Código', isKey: true }, { name: 'Banco', isKey: false }] };
        },
        [`/datasets/${BANKS}`]: () => loaded,
        [`/datasets/${BANKS}/rows`]: () => page([]),
      }),
    });

    expect(await screen.findByText(/Aún no hay archivos de Excel/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar Excel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cargar un Excel' });
    const input = within(dialog).getByLabelText(/Archivo \.xlsx/);
    await userEvent.upload(input, new File(['a,b'], 'bancos.csv', { type: 'text/csv' }), { applyAccept: false });
    expect(within(dialog).getByText('Solo se aceptan archivos .xlsx.')).toBeInTheDocument();
    await userEvent.upload(input, xlsx('bancos.xlsx'));
    expect(within(dialog).getByRole('textbox', { name: /Nombre/ })).toHaveValue('bancos');
    await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: /Lo pueden usar/ }), 'Confirmación de pagos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar' }));

    expect(await within(dialog).findByText('Se cargaron 3 filas con 2 columnas.')).toBeInTheDocument();
    expect(fake.calls.find((call) => call.path === '/datasets' && call.options.method === 'POST')?.options.body).toEqual({ name: 'bancos', fileId: FILE_ID, workflowId: FLOW });
    expect(put).toHaveBeenCalledTimes(1);

    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /Columna clave/ }), 'Código');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usar como clave' }));
    expect(await within(dialog).findByText('La fila 4 repite un valor de la columna clave.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usar como clave' }));
    expect(await within(dialog).findByText('La columna clave es «Código».')).toBeInTheDocument();
    expect(fake.callsTo(`/datasets/${BANKS}/content`).map((call) => call.options.body)).toEqual([
      { fileId: FILE_ID, keyColumn: 'Código' },
      { fileId: FILE_ID, keyColumn: 'Código' },
    ]);
    expect(put).toHaveBeenCalledTimes(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Listo' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/workflows/datasets/${BANKS}`));
  });

  it('says what is wrong with a spreadsheet the API refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
    renderRoute('/workflows/datasets', {
      handlers: api({
        '/datasets': (options) => {
          if (options.method === 'POST') throw new ApiError({ status: 422, code: 'DATASET_FILE_INVALID', message: 'x', details: { problem: 'DUPLICATE_HEADER', detail: 'Nombre' } });
          return page([]);
        },
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Cargar Excel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cargar un Excel' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar' }));
    expect(within(dialog).getByText('Elige el archivo.')).toBeInTheDocument();
    await userEvent.upload(within(dialog).getByLabelText(/Archivo \.xlsx/), xlsx('clientes.xlsx'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar' }));

    expect(await within(dialog).findByText('Hay dos columnas llamadas «Nombre».')).toBeInTheDocument();
  });

  it('shows what was loaded and its rows, with the key column marked', async () => {
    renderRoute(`/workflows/datasets/${CLIENTS}`, { handlers: api() });

    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(screen.getByText('clientes.xlsx')).toBeInTheDocument();
    expect(screen.getByText('2 filas, 2 columnas')).toBeInTheDocument();
    const rows = await screen.findByRole('table', { name: 'Filas de «Clientes»' });
    expect(within(rows).getByRole('columnheader', { name: 'Cédula (clave)' })).toBeInTheDocument();
    expect(await within(rows).findByText('Luis Gómez')).toBeInTheDocument();
  });

  it('loads another file over it, and names the columns a field still reads when the new one lacks them', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
    const { fake } = renderRoute(`/workflows/datasets/${CLIENTS}`, {
      handlers: api({
        [`/datasets/${CLIENTS}/content`]: () => {
          throw new ApiError({ status: 409, code: 'DATASET_IN_USE', message: 'x', details: { columns: ['Nombre'] } });
        },
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Cargar otro archivo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cargar otro archivo' });
    expect(within(dialog).queryByRole('textbox', { name: /Nombre/ })).toBeNull();
    await userEvent.upload(within(dialog).getByLabelText(/Archivo \.xlsx/), xlsx('clientes-2.xlsx'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar' }));

    expect(await within(dialog).findByText(/campos que usan columnas que el archivo nuevo no tiene: «Nombre»/)).toBeInTheDocument();
    expect(fake.callsTo(`/datasets/${CLIENTS}/content`)[0]?.options.body).toEqual({ fileId: FILE_ID });
  });

  it('renames and deactivates it, and then says forms no longer offer its values', async () => {
    const { fake } = renderRoute(`/workflows/datasets/${CLIENTS}`, { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar el Excel' });
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /Nombre/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Clientes 2026');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Activo/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.options.method === 'PATCH')?.options.body).toEqual({ name: 'Clientes 2026', isActive: false }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes 2026' })).toBeInTheDocument();
    expect(screen.getByText(/está inactivo: los formularios no ofrecen sus valores/)).toBeInTheDocument();
  });

  it('refuses to delete one a field uses, and deletes it otherwise', async () => {
    let inUse = true;
    const handlers = api();
    const { router } = renderRoute(`/workflows/datasets/${CLIENTS}`, {
      handlers: {
        ...handlers,
        [`/datasets/${CLIENTS}`]: (options, path) => {
          if (options.method !== 'DELETE') return handlers[`/datasets/${CLIENTS}`]!(options, path);
          if (inUse) throw new ApiError({ status: 409, code: 'DATASET_IN_USE', message: 'x', details: { columns: [] } });
          return undefined;
        },
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar el Excel' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    expect(await within(dialog).findByText(/Algún campo de un flujo usa este Excel/)).toBeInTheDocument();

    inUse = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/workflows/datasets'));
  });

  it('lets a reader look but not change anything', async () => {
    renderRoute(`/workflows/datasets/${CLIENTS}`, { handlers: { ...api(), '/auth/me/permissions': () => ({ permissions: [{ action: 'read', subject: 'Workflow', conditional: false }] }) } });

    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar otro archivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull();
  });
});
