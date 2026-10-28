import type { StepDocument, TransitionDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { RealtimeClient } from '@/shared/realtime';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';
import { at, DRAFT, END, FLOW, id, link, START, startingDoc, step, versionOf, versionUrl } from '../test/builder-fixtures';

const CHECK = id(32);
/** An export as `GET /exports` lists it; the tests only change its id, workflow and name. */
const fullExport = {
  workflowName: 'Confirmación de pagos',
  companyId: null,
  format: 'CSV',
  sheetName: 'Export',
  delimiter: ';',
  trigger: 'CLOSING',
  transitionLabel: null,
  filter: [],
  mergeBy: null,
  separateBy: null,
  schedule: { cutoffTime: '17:00', frequency: 'DAILY', weekdays: [], monthDay: null, intervalDays: null },
  isActive: true,
  columns: [{ header: 'A', sourceType: 'CONSTANT', sourceRef: 'x', format: null }],
  pendingLines: 0,
  lastAutoCutoffAt: null,
  nextCutoffAt: null,
  createdAt: at,
};
const url = versionUrl;

/** A fake API that keeps the version in memory: saving replaces it (giving ids to new rows) and publishing changes its status. */
function api(initial: WorkflowVersionDocument = startingDoc(), options: { status?: string; save?: FakeHandler; publish?: FakeHandler } = {}) {
  let document = initial;
  let status = options.status ?? 'DRAFT';
  let revision = 0;
  let ids = 100;
  const handlers: Record<string, FakeHandler> = {
    [url]: () => ({ workflow: { id: FLOW, name: 'Confirmación de pagos', subcategoryId: id(11) }, version: versionOf(status, revision), document, validation: null }),
    [`${url}/graph`]:
      options.save ??
      ((request) => {
        const body = request.body as { steps: Array<Record<string, unknown>>; transitions: Array<Record<string, unknown>> };
        const idMap: Record<string, string> = {};
        const real = (ref: string) => {
          if (!ref.startsWith('new:')) return ref;
          idMap[ref] ??= id((ids += 1));
          return idMap[ref];
        };
        const previous = new Map(document.steps.map((candidate) => [candidate.id, candidate]));
        document = {
          ...document,
          steps: body.steps.map((saved) => ({ ...step('', 'TASK', ''), ...(previous.get(saved.id as string) ?? {}), ...saved, id: real(saved.id as string) }) as StepDocument),
          transitions: body.transitions.map((saved) => ({ ...saved, id: real(saved.id as string), fromStepId: real(saved.fromStepId as string), toStepId: real(saved.toStepId as string) }) as TransitionDocument),
        };
        revision += 1;
        return { revision, idMap, document, validation: { errors: [], warnings: [] } };
      }),
    [`${url}/publish`]:
      options.publish ??
      (() => {
        status = 'PUBLISHED';
        return { version: versionOf(status, revision), warnings: [] };
      }),
    [`/workflows/${FLOW}`]: () => ({ id: FLOW, subcategoryId: id(11), name: 'Confirmación de pagos', isActive: true, createdAt: at, versions: [versionOf(status, revision)] }),
    '/workflows': () => ({ items: [], page: 1, pageSize: 100, total: 0 }),
    [`/workflows/${FLOW}/versions`]: () => ({ ...versionOf('DRAFT'), id: id(23), number: 3 }),
    '/approval-group-types': () => ({ items: [{ id: id(70), name: 'Jefe inmediato', levels: 2, isActive: true, createdAt: at }], page: 1, pageSize: 100, total: 1 }),
  };
  return handlers;
}

const outline = () => screen.getByRole('navigation', { name: 'Bloques del flujo' });

describe('workflow builder', () => {
  it('closes the block palette and «Propiedades» to give the canvas the width, and remembers it in this browser', async () => {
    onTestFinished(() => window.localStorage.clear());
    const doc = startingDoc();
    const first = renderRoute(url, { handlers: api(doc) });
    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    expect(screen.getByRole('navigation', { name: 'Bloques para agregar' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Bloques' }));
    await userEvent.click(screen.getByRole('button', { name: 'Propiedades' }));
    expect(screen.queryByRole('navigation', { name: 'Bloques para agregar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Propiedades' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bloques' })).toHaveAttribute('aria-pressed', 'false');

    first.unmount();
    renderRoute(url, { handlers: api(doc) });
    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    expect(screen.queryByRole('navigation', { name: 'Bloques para agregar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Propiedades' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bloques' }));
    await userEvent.click(screen.getByRole('button', { name: 'Propiedades' }));
    expect(screen.getByRole('navigation', { name: 'Bloques para agregar' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Propiedades' })).toBeInTheDocument();
  });

  it('opens blocks as tabs over the inspector, goes back and closes them, and folds sections', async () => {
    const PAY = id(43);
    const doc: WorkflowVersionDocument = {
      ...startingDoc(),
      steps: [step(START, 'START', 'Inicio'), step(PAY, 'TASK', 'Pagar', { ui: { x: 240, y: 0 } }), step(END, 'END', 'Fin', { ui: { x: 480, y: 0 } })],
      transitions: [link(id(50), START, PAY), link(id(51), PAY, END, { type: 'DECISION', label: 'Pagado' })],
    };
    renderRoute(url, { handlers: api(doc) });
    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    window.sessionStorage.clear();

    await userEvent.click(within(outline()).getByRole('button', { name: /Pagar/ }));
    await userEvent.click(within(outline()).getByRole('button', { name: /Fin/ }));
    const tabs = screen.getByRole('navigation', { name: 'Bloques abiertos' });
    expect(within(tabs).getAllByRole('button').filter((button) => !button.getAttribute('aria-label')?.startsWith('Cerrar')).map((button) => button.textContent)).toEqual(['Pagar', 'Fin']);
    expect(within(tabs).getByRole('button', { name: 'Fin' })).toHaveAttribute('aria-current', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Anterior abierto' }));
    const inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    expect(within(inspector).getByRole('heading', { level: 2, name: 'Pagar' })).toBeInTheDocument();

    // Sections fold from their title and from the bar; folded content is hidden, not lost.
    const bar = within(inspector).getByRole('navigation', { name: 'Secciones del bloque' });
    const general = within(inspector).getByRole('button', { name: 'General' });
    expect(general).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(general);
    expect(general).toHaveAttribute('aria-expanded', 'false');
    expect(within(inspector).getAllByRole('textbox', { name: /^Nombre/, hidden: true })[0]).not.toBeVisible();
    await userEvent.click(within(bar).getByRole('button', { name: 'Ir a General' }));
    expect(within(inspector).getAllByRole('textbox', { name: /^Nombre/ })[0]).toBeVisible();
    await userEvent.click(within(bar).getByRole('button', { name: 'Plegar todas' }));
    expect(within(bar).getByRole('button', { name: 'Desplegar todas' })).toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole('button', { name: 'Cerrar Pagar' }));
    expect(within(inspector).getByRole('heading', { level: 2, name: 'Fin' })).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('button', { name: 'Cerrar Fin' }));
    expect(within(inspector).getByRole('heading', { name: 'Propiedades' })).toBeInTheDocument();
  }, 15_000);

  it('shows on the canvas who can create and what each step carries, and lists the blocks in a table', async () => {
    const PAY = id(42);
    const CARTERA = id(80);
    const doc: WorkflowVersionDocument = {
      ...startingDoc(),
      steps: [
        step(START, 'START', 'Inicio', { initiators: [{ id: id(81), participantType: 'DEPARTMENT', userId: null, positionId: null, groupId: null, departmentId: CARTERA, companyId: null, siteId: null }] }),
        step(PAY, 'TASK', 'Pagar', { allowsBatch: true, deadlineType: 'CUTOFF', ui: { x: 240, y: 0 } }),
        step(END, 'END', 'Fin', { ui: { x: 480, y: 0 } }),
      ],
      transitions: [link(id(50), START, PAY), link(id(51), PAY, END, { type: 'DECISION', label: 'Pagado' })],
    };
    renderRoute(url, { handlers: { ...api(doc), '/departments': () => ({ items: [{ id: CARTERA, name: 'Cartera', isActive: true, createdAt: at }], page: 1, pageSize: 100, total: 1 }) } });

    const canvas = await screen.findByRole('region', { name: 'Lienzo del flujo' });
    expect(await within(canvas).findByText('Cartera')).toBeInTheDocument();
    expect(within(canvas).getByText('Quién puede crear')).toBeInTheDocument();
    expect(within(canvas).getByText('Corte')).toBeInTheDocument();
    expect(within(canvas).getByText('Lote')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table', { name: 'Bloques del flujo en una tabla' });
    expect(within(table).getByText('Pagado → Fin')).toBeInTheDocument();
    expect(within(table).getByText('Corte · Lote')).toBeInTheDocument();
    await userEvent.click(within(table).getByText('Pagar'));
    expect(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('heading', { name: 'Pagar' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lienzo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar' }));
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Los bloques quedaron ordenados de izquierda a derecha, con los menos cruces posibles.');
  }, 15_000);

  it('opens a draft valid and saved, and adds a step that the validation flags until it is wired', async () => {
    renderRoute(url, { handlers: api() });

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' })).toBeInTheDocument();
    expect(screen.getByText('Borrador · v2')).toBeInTheDocument();
    expect(screen.getByText('Todo guardado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Validación\s*Sin problemas/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Agregar Paso' }));

    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
    const inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    expect(within(inspector).getByRole('heading', { name: 'Nuevo paso' })).toBeInTheDocument();
    expect(within(inspector).getByText('Ningún camino desde el Inicio llega a este bloque.')).toBeInTheDocument();
    expect(within(inspector).getByRole('combobox', { name: 'Modo de asignación' })).toHaveDisplayValue('Quien creó el ticket');
    expect(screen.getByRole('button', { name: /Validación\s*3 errores/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Se agregó el bloque Nuevo paso.');
  }, 15_000);

  it('gives a step the assignee of an earlier one, and asks for the step until it is chosen', async () => {
    const REVIEW = id(40);
    const SETTLE = id(41);
    const doc: WorkflowVersionDocument = {
      ...startingDoc(),
      steps: [step(START, 'START', 'Inicio'), step(REVIEW, 'TASK', 'Revisar pago'), step(SETTLE, 'TASK', 'Liquidar'), step(END, 'END', 'Fin')],
      transitions: [link(id(50), START, REVIEW), link(id(51), REVIEW, SETTLE, { type: 'DECISION' }), link(id(52), SETTLE, END, { type: 'DECISION' })],
    };
    const { fake } = renderRoute(url, { handlers: api(doc) });

    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    await userEvent.click(within(outline()).getByRole('button', { name: /Liquidar/ }));
    const inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    await userEvent.selectOptions(within(inspector).getByRole('combobox', { name: 'Modo de asignación' }), 'Mismo responsable que otro paso');
    expect(within(inspector).getByText('Elige el paso cuyo responsable atiende este.')).toBeInTheDocument();
    const source = within(inspector).getByRole('combobox', { name: 'Paso' });
    expect(within(source).getAllByRole('option').map((option) => option.textContent)).toEqual(['Elige un paso', 'Revisar pago']);
    await userEvent.selectOptions(source, 'Revisar pago');
    expect(within(inspector).queryByText('Elige el paso cuyo responsable atiende este.')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(screen.getByText('Todo guardado')).toBeInTheDocument());
    const body = fake.callsTo(`${url}/graph`)[0]?.options.body as { steps: Array<{ id: string; assignmentMode: string; sameAssigneeStepId: string | null }> };
    expect(body.steps.find((saved) => saved.id === SETTLE)).toMatchObject({ assignmentMode: 'SAME_AS_STEP', sameAssigneeStepId: REVIEW });
  }, 15_000);

  it('makes a step wait for the file of one of the workflow\'s exports', async () => {
    const REVIEW = id(42);
    const doc: WorkflowVersionDocument = {
      ...startingDoc(),
      steps: [step(START, 'START', 'Inicio'), step(REVIEW, 'TASK', 'Confirmar pago'), step(END, 'END', 'Fin')],
      transitions: [link(id(50), START, REVIEW), link(id(51), REVIEW, END, { type: 'DECISION' })],
    };
    const exportOf = (exportId: string, name: string, workflowId: string) => ({ id: exportId, workflowId, name });
    const { fake } = renderRoute(url, {
      handlers: { ...api(doc), '/exports': () => [exportOf(id(90), 'Contabilización', FLOW), exportOf(id(91), 'De otro flujo', id(99))].map((row) => ({ ...fullExport, ...row })) },
    });

    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    await userEvent.click(within(outline()).getByRole('button', { name: /Confirmar pago/ }));
    const inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    const required = await within(inspector).findByRole('combobox', { name: /Exige el corte del plano/ });
    await within(required).findByRole('option', { name: 'Contabilización' });
    expect(within(required).getAllByRole('option').map((option) => option.textContent)).toEqual(['No exige', 'Contabilización']);
    await userEvent.selectOptions(required, 'Contabilización');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect((fake.callsTo(`${url}/graph`)[0]?.options.body as { steps: Array<{ id: string; config: Record<string, unknown> }> }).steps.find((saved) => saved.id === REVIEW)?.config).toEqual({ requiredExportId: id(90) }));
  }, 15_000);

  // A long walk through the inspector: on a loaded machine it can pass the default 5 s.
  it('wires a new step between start and end from the inspector, and saves it with its revision', async () => {
    const { fake } = renderRoute(url, { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Paso' }));
    let inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    await userEvent.clear(within(inspector).getByRole('textbox', { name: /Nombre/ }));
    await userEvent.type(within(inspector).getByRole('textbox', { name: /Nombre/ }), 'Revisar pago');
    await userEvent.selectOptions(within(inspector).getByRole('combobox', { name: 'Agregar salida hacia' }), 'Fin');
    await userEvent.click(within(inspector).getByRole('button', { name: 'Conectar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Se conectó Revisar pago con Fin.');

    // Point the start at the new step: open the start's way out and remove it, then wire start → step.
    await userEvent.click(within(outline()).getByRole('button', { name: 'Inicio: Inicio' }));
    inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    await userEvent.click(within(inspector).getByRole('button', { name: 'Continuar → Fin' }));
    await userEvent.click(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('button', { name: 'Eliminar conexión' }));
    await userEvent.click(within(outline()).getByRole('button', { name: 'Inicio: Inicio' }));
    inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    await userEvent.selectOptions(within(inspector).getByRole('combobox', { name: 'Agregar salida hacia' }), 'Revisar pago');
    await userEvent.click(within(inspector).getByRole('button', { name: 'Conectar' }));

    expect(screen.getByRole('button', { name: /Validación\s*Sin problemas/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(screen.getByText('Todo guardado')).toBeInTheDocument());
    const body = fake.callsTo(`${url}/graph`)[0]?.options.body as { revision: number; steps: Array<{ id: string; name: string; type: string }>; transitions: Array<{ fromStepId: string; toStepId: string; type: string; label: string }> };
    expect(body.revision).toBe(0);
    expect(body.steps.map((saved) => [saved.type, saved.name])).toEqual([
      ['START', 'Inicio'],
      ['END', 'Fin'],
      ['TASK', 'Revisar pago'],
    ]);
    expect(body.transitions.map((saved) => [saved.type, saved.label])).toEqual([
      ['DECISION', 'Continuar'],
      ['DEFAULT', 'Continuar'],
    ]);
    // The new connection stays selected under the id the API gave it.
    expect(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('heading', { name: 'Inicio → Revisar pago' })).toBeInTheDocument();

    await userEvent.click(within(outline()).getByRole('button', { name: 'Paso: Revisar pago' }));
    await userEvent.type(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('textbox', { name: 'Plazo' }), '2');
    await userEvent.keyboard('{Control>}s{/Control}');
    await vi.waitFor(() => expect(fake.callsTo(`${url}/graph`)).toHaveLength(2));
    const second = fake.callsTo(`${url}/graph`)[1]?.options.body as { revision: number; steps: Array<{ name: string; slaValue: number | null; slaUnit: string | null }> };
    expect(second.revision).toBe(1);
    expect(second.steps.find((saved) => saved.name === 'Revisar pago')).toMatchObject({ slaValue: 2, slaUnit: 'BUSINESS_DAYS' });
  }, 15_000);

  it('writes the rule of a condition branch with the fields of the version', async () => {
    const doc: WorkflowVersionDocument = {
      steps: [step(START, 'START', 'Inicio'), step(CHECK, 'CONDITION', 'Revisar monto'), step(END, 'END', 'Fin')],
      transitions: [link(id(40), START, CHECK), link(id(41), CHECK, END, { label: 'En otro caso' }), link(id(42), CHECK, END, { type: 'CONDITION', label: 'Grande', condition: [{ field: 'PAYMENT_TYPE', op: 'equals', value: 'cash' }], sortOrder: 1 })],
      fields: [
        { id: id(50), stepId: START, code: 'AMOUNT', label: 'Monto', type: 'CURRENCY', capture: 'CREATION', isRequired: true, isReadOnly: false, isImmutable: false, sortOrder: 0, config: {}, dataSource: null },
        { id: id(51), stepId: START, code: 'PAYMENT_TYPE', label: 'Tipo de pago', type: 'SELECT', capture: 'CREATION', isRequired: true, isReadOnly: false, isImmutable: false, sortOrder: 1, config: { options: [{ value: 'cash', label: 'Efectivo' }, { value: 'transfer', label: 'Transferencia' }] }, dataSource: null },
      ],
      amountRules: [],
    };
    const { fake } = renderRoute(url, { handlers: api(doc) });

    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    await userEvent.click(within(outline()).getByRole('button', { name: 'Condición: Revisar monto' }));
    await userEvent.click(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('button', { name: 'Grande → Fin' }));
    const inspector = screen.getByRole('complementary', { name: 'Propiedades' });
    expect(within(inspector).getByRole('combobox', { name: 'Valor' })).toHaveDisplayValue('Efectivo');
    await userEvent.selectOptions(within(inspector).getByRole('combobox', { name: 'Valor' }), 'Transferencia');

    await userEvent.click(within(inspector).getByRole('button', { name: 'Agregar condición' }));
    await userEvent.selectOptions(within(inspector).getAllByRole('combobox', { name: 'Campo' })[1]!, 'Monto (AMOUNT)');
    await userEvent.selectOptions(within(inspector).getAllByRole('combobox', { name: 'Operador' })[1]!, 'es mayor o igual que');
    const amount = within(inspector).getAllByRole('textbox', { name: 'Valor' })[0]!;
    await userEvent.clear(amount);
    await userEvent.type(amount, '5000000');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(fake.callsTo(`${url}/graph`)).toHaveLength(1));
    const body = fake.callsTo(`${url}/graph`)[0]?.options.body as { transitions: Array<{ label: string; condition: unknown }> };
    expect(body.transitions.find((saved) => saved.label === 'Grande')?.condition).toEqual([
      { field: 'PAYMENT_TYPE', op: 'equals', value: 'transfer' },
      { field: 'AMOUNT', op: 'gte', value: 5000000 },
    ]);
  });

  it('says when someone else saved first, and offers to reload', async () => {
    renderRoute(url, {
      handlers: api(startingDoc(), {
        save: () => {
          throw new ApiError({ status: 409, code: 'STALE_REVISION', message: 'x', details: { currentRevision: 3 } });
        },
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Fin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(/Alguien más guardó este borrador/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
  });

  it('publishes a valid draft, saving first, and then shows it read only', async () => {
    const { fake } = renderRoute(url, { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Fin' }));
    await userEvent.click(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('button', { name: 'Eliminar bloque' }));
    await userEvent.click(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('button', { name: 'Eliminar bloque' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar la versión v2' });
    expect(within(dialog).getByText('Primero se guardarán tus cambios.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Notas/ }), 'Primera versión');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    expect(await screen.findByText('Se publicó la versión v2. Los tickets nuevos ya la siguen.')).toBeInTheDocument();
    expect(fake.callsTo(`${url}/graph`)).toHaveLength(1);
    expect(fake.callsTo(`${url}/publish`)[0]?.options.body).toEqual({ notes: 'Primera versión' });
    expect(await screen.findByText(/Esta versión ya no se cambia/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Bloques para agregar' })).not.toBeInTheDocument();
  });

  it('keeps publishing closed while there are errors', async () => {
    renderRoute(url, { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Aprobación' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar la versión v2' });

    expect(within(dialog).getByText('Corrige los errores antes de publicar.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Publicar' })).toBeDisabled();
  });

  it('shows what only the server finds when it refuses to publish', async () => {
    const calculatorDoc: WorkflowVersionDocument = startingDoc();
    renderRoute(url, {
      handlers: api(calculatorDoc, {
        publish: () => {
          throw new ApiError({ status: 422, code: 'WORKFLOW_NOT_PUBLISHABLE', message: 'x', details: { errors: [{ code: 'CALCULATOR_NOT_CONFIGURED', severity: 'error', stepId: START, params: { code: 'MEAL_ALLOWANCE' } }], warnings: [] } });
        },
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Publicar la versión v2' })).getByRole('button', { name: 'Publicar' }));

    const panel = await screen.findByRole('region', { name: 'Validación del flujo' });
    expect(within(panel).getByText(/La calculadora MEAL_ALLOWANCE no está activada en la organización/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /Inicio:/ }));
    expect(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const { router } = renderRoute(url, { handlers: api() });

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Paso' }));
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Ruta de navegación' })).getByRole('link', { name: 'Flujos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cambios sin guardar' });
    expect(router.state.location.pathname).toBe(url);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salir sin guardar' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/workflows'));
  });

  it('shows a published version without the editing', async () => {
    renderRoute(url, { handlers: api(startingDoc(), { status: 'PUBLISHED' }) });

    expect(await screen.findByText(/Esta versión ya no se cambia/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Bloques para agregar' })).not.toBeInTheDocument();
    await userEvent.click(within(outline()).getByRole('button', { name: 'Inicio: Inicio' }));
    expect(within(screen.getByRole('complementary', { name: 'Propiedades' })).getByRole('textbox', { name: /Nombre/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Eliminar bloque' })).not.toBeInTheDocument();
  });

  it('makes a draft from a published version and opens it', async () => {
    const { fake, router } = renderRoute(url, { handlers: api(startingDoc(), { status: 'PUBLISHED' }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Crear borrador desde esta versión' }));

    await vi.waitFor(() => expect(fake.callsTo(`/workflows/${FLOW}/versions`)[0]?.options.body).toEqual({ fromVersionId: DRAFT }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/workflows/${FLOW}/versions/${id(23)}`));
  });

  it('inside a draft offers no other draft, even with the workflow page already read', async () => {
    renderRoute(`/workflows/${FLOW}`, { handlers: api() });

    await userEvent.click(await screen.findByRole('link', { name: 'Editar el borrador v2' }));

    expect(await screen.findByText('Todo guardado')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Abrir el borrador/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear borrador desde esta versión' })).not.toBeInTheDocument();
  });

  it('a reader sees the draft without the editing', async () => {
    renderRoute(url, { handlers: { ...api(), '/auth/me/permissions': () => ({ permissions: [{ action: 'read', subject: 'Workflow', conditional: false }] }) } });

    expect(await screen.findByText('Tu rol puede ver el flujo pero no cambiarlo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
  });

  it('says when the version is not there', async () => {
    renderRoute(url, {
      handlers: {
        ...api(),
        [url]: () => {
          throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'x' });
        },
      },
    });

    expect(await screen.findByText('No encontramos esta versión del flujo.')).toBeInTheDocument();
  });
});

describe('«Crear con IA» in the builder', () => {
  const JOB = id(95);
  const OLD_JOB = id(94);
  const PAY = id(96);
  const availability = `/ai-assistant/availability`;
  const historyUrl = `${url}/ai-jobs`;
  const DESCRIPTION = 'El asesor pide un anticipo y tesorería lo paga.';
  type Job = { readonly id: string; readonly status: string } & Record<string, unknown>;
  const job = (status: string, overrides: Record<string, unknown> = {}): Job => ({
    id: JOB,
    kind: 'WORKFLOW_DRAFT',
    status,
    stage: null,
    round: null,
    problems: null,
    errorCode: null,
    result: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    description: DESCRIPTION,
    requestedById: id(1),
    requesterName: 'Ana Torres',
    cancelledByName: null,
    tokens: 0,
    ...overrides,
  });
  const aiDraftDoc = (): WorkflowVersionDocument => ({
    ...startingDoc(),
    steps: [step(START, 'START', 'Inicio'), step(PAY, 'TASK', 'Pagar anticipo'), step(END, 'END', 'Fin')],
    transitions: [link(id(97), START, PAY), link(id(98), PAY, END, { type: 'DECISION', label: 'Pagado' })],
  });

  /** A socket that is always connected: the test fires its events (polling is then 30 s, so only events move the panel). */
  function fakeRealtime() {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const followed: string[] = [];
    const client: RealtimeClient = {
      isConnected: () => true,
      onConnectionChange: () => () => undefined,
      on: (event, listener) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener as (payload: unknown) => void);
        listeners.set(event, set);
        return () => set.delete(listener as (payload: unknown) => void);
      },
      followAiDraft: (versionId) => {
        followed.push(versionId);
        return () => undefined;
      },
      dispose: () => undefined,
    };
    const fire = (jobId = JOB) => act(() => listeners.get('ai_job.changed')?.forEach((listener) => listener({ jobId, versionId: DRAFT })));
    return { client, followed, fire };
  }

  /**
   * The builder's API plus the assistant. `history` is what `GET …/ai-jobs` answers now (the test changes it); the
   * version is rewritten on the server once a request succeeds.
   */
  function aiApi(state: { history: Job[] }, request: FakeHandler = () => ({ jobId: JOB }), initial: WorkflowVersionDocument = startingDoc()) {
    const base = api(initial);
    return {
      ...base,
      [url]: (options: Parameters<FakeHandler>[0], path: string) => {
        const detail = base[url]!(options, path) as Record<string, unknown>;
        return state.history.some((entry) => entry.status === 'SUCCEEDED') ? { ...detail, version: versionOf('DRAFT', 1), document: aiDraftDoc() } : detail;
      },
      [availability]: () => ({ available: true, remainingJobsToday: 4, activeJobId: null }),
      [historyUrl]: () => ({ jobs: state.history }),
      [`${url}/ai-draft`]: (options: Parameters<FakeHandler>[0], path: string) => {
        const answer = request(options, path);
        const body = options.body as { mode: string; description: string };
        state.history = [...state.history, job('PENDING', { kind: body.mode === 'REVISE' ? 'WORKFLOW_DRAFT_REVISION' : 'WORKFLOW_DRAFT', description: body.description })];
        return answer;
      },
      [`/ai-jobs/${JOB}/cancel`]: () => {
        state.history = state.history.map((entry) => (entry.id === JOB ? { ...entry, status: 'FAILED', errorCode: 'CANCELLED', cancelledByName: 'Luis Gómez', completedAt: at } : entry));
        return job('FAILED', { errorCode: 'CANCELLED' });
      },
    };
  }
  const panel = () => screen.getByRole('region', { name: 'Crear el flujo con IA' });
  const openPanel = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Crear con IA' }));
    return panel();
  };
  const describeProcess = async (region: HTMLElement) => {
    await userEvent.type(within(region).getByRole('textbox', { name: /Descripción del proceso/ }), DESCRIPTION);
    await userEvent.click(within(region).getByRole('button', { name: 'Armar el borrador' }));
  };

  afterEach(() => window.sessionStorage.clear());

  it('is not offered while the organization has the assistant off', async () => {
    renderRoute(url, { handlers: { ...api(), [availability]: () => ({ available: false, remainingJobsToday: 0, activeJobId: null }) } });
    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    expect(screen.queryByRole('button', { name: 'Crear con IA' })).not.toBeInTheDocument();
  });

  it('sends the description, follows each stage live from the socket, and opens the new draft with what the AI assumed', async () => {
    const state = { history: [] as Job[] };
    const realtime = fakeRealtime();
    const { fake } = renderRoute(url, { handlers: aiApi(state), realtime: realtime.client });
    const region = await openPanel();
    expect(realtime.followed).toEqual([DRAFT]);
    expect(within(region).getByText('Quedan 4 solicitudes hoy para la organización.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Armar el borrador' })).toBeDisabled();
    await describeProcess(region);

    expect(fake.callsTo(`${url}/ai-draft`)[0]?.options.body).toEqual({ mode: 'CREATE', description: DESCRIPTION, revision: 0 });
    const history = await within(region).findByRole('list', { name: 'Solicitudes a la IA de este borrador' });
    expect(await within(history).findByText('En cola…')).toBeInTheDocument();
    expect(within(history).getByText(DESCRIPTION)).toBeInTheDocument();
    expect(within(region).getByRole('textbox', { name: /Descripción del proceso/ })).toHaveValue('');
    expect(within(region).getByRole('button', { name: 'Armar el borrador' })).toBeDisabled();

    state.history = [job('RUNNING', { startedAt: at, stage: 'DESIGNING', round: 1 })];
    realtime.fire();
    expect(await within(history).findByText('La IA está diseñando el flujo (ronda 1)…')).toBeInTheDocument();

    state.history = [job('RUNNING', { startedAt: at, stage: 'REVIEWING', round: 1, problems: 3, tokens: 12_500 })];
    realtime.fire();
    expect(await within(history).findByText('Revisando la ronda 1: encontró 3 problemas y se los devuelve a la IA para corregirlos…')).toBeInTheDocument();
    expect(within(history).getByText('12.500 tokens')).toBeInTheDocument();

    const result = {
      revision: 1,
      assumptions: ['Tesorería paga por transferencia.'],
      decisions: [
        { topic: 'APPROVALS', text: 'El jefe aprueba primero, como pide la descripción.' },
        { topic: 'ROUTING', text: 'Los anticipos de más de 5 millones pasan por gerencia.' },
      ],
      outline: { steps: 7, approvals: 2, fields: 4, initiators: 0, amountRules: 1 },
      corrections: 3,
      rounds: 2,
      errors: 0,
      warnings: 0,
    };
    state.history = [job('SUCCEEDED', { startedAt: at, completedAt: at, stage: 'WRITING', round: 2, result, tokens: 25_000 })];
    realtime.fire();
    expect(await screen.findByText(/La IA actualizó el borrador\. Revísalo antes de publicar: en el panel de IA está lo que decidió/)).toBeInTheDocument();
    expect(await within(outline()).findByRole('button', { name: /Pagar anticipo/ })).toBeInTheDocument();
    // The panel stays open on the new draft, with the request's outcome and what the AI decided.
    const answer = panel();
    expect(await within(answer).findByText('Borrador listo en 2 rondas.')).toBeInTheDocument();
    expect(within(answer).getByText('7 pasos · 2 aprobaciones · 4 campos · 1 regla de monto')).toBeInTheDocument();
    expect(within(answer).getByText('La revisión le devolvió 3 problemas a la IA para corregirlos.')).toBeInTheDocument();
    expect(within(answer).getByText('Lo que decidió (2)')).toBeVisible();
    expect(within(answer).getByText('Aprobaciones')).toBeInTheDocument();
    expect(within(answer).getByText('Los anticipos de más de 5 millones pasan por gerencia.')).toBeVisible();
    expect(within(answer).getByText('Tesorería paga por transferencia.')).toBeVisible();
    // The draft has content now: the next message asks for a change to it.
    expect(within(answer).getByRole('textbox', { name: /Cambio al borrador/ })).toBeInTheDocument();
  }, 20_000);

  it('announces the progress to screen readers without the ticking time', async () => {
    const state = { history: [job('RUNNING', { startedAt: at, stage: 'WRITING', round: 1 })] };
    renderRoute(url, { handlers: aiApi(state), realtime: fakeRealtime().client });
    const region = await openPanel();
    await within(region).findAllByText('Escribiendo el borrador…');
    const live = screen.getAllByRole('status').find((element) => element.textContent === 'Escribiendo el borrador…');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('folds the summary of older drafts and reads results stored before it existed', async () => {
    const older = { revision: 1, assumptions: ['Supuesto viejo.'], rounds: 1, errors: 0, warnings: 0 };
    const newer = { ...older, revision: 2, assumptions: [], decisions: [{ topic: 'FIELDS', text: 'Pide el valor del anticipo.' }], outline: null, corrections: 0 };
    const state = { history: [job('SUCCEEDED', { id: OLD_JOB, completedAt: at, result: older }), job('SUCCEEDED', { completedAt: at, result: newer })] };
    renderRoute(url, { handlers: aiApi(state), realtime: fakeRealtime().client });
    const history = await within(await openPanel()).findByRole('list', { name: 'Solicitudes a la IA de este borrador' });
    const [first, second] = [...history.children].filter((item) => item.textContent !== '') as HTMLElement[];
    expect(within(first!).getByText('Lo que supuso porque no estaba en la descripción (1)').closest('details')).not.toHaveAttribute('open');
    expect(within(first!).queryByText(/pasos/)).not.toBeInTheDocument();
    expect(within(second!).getByText('Lo que decidió (1)').closest('details')).toHaveAttribute('open');
  });

  it('says which settings made in the editor a change kept, and which it lost', async () => {
    const changed = {
      revision: 2, assumptions: [], decisions: [], outline: null, corrections: 0, rounds: 1, errors: 0, warnings: 0,
      keptSettings: [{ subject: 'STEP', name: 'Pagar anticipo', properties: ['closeRule', 'files'] }],
      droppedSettings: [{ subject: 'FIELD', name: 'Monto', properties: ['isReadOnly'] }],
    };
    renderRoute(url, { handlers: aiApi({ history: [job('SUCCEEDED', { kind: 'WORKFLOW_DRAFT_REVISION', completedAt: at, result: changed })] }), realtime: fakeRealtime().client });
    const region = await openPanel();
    const dropped = (await within(region).findByText('Ajustes que se perdieron porque la IA cambió o quitó su elemento (1)')).closest('details')!;
    expect(dropped).toHaveAttribute('open');
    expect(within(dropped).getByText('Campo «Monto»: solo lectura')).toBeInTheDocument();
    const kept = within(region).getByText('Ajustes hechos en el editor que la IA no ve y se conservaron (1)').closest('details')!;
    expect(within(kept).getByText('Paso «Pagar anticipo»: permite cerrar el ticket, archivos adjuntos')).toBeInTheDocument();
  });

  it('shows the history of the draft like a conversation: who asked what, how it ended and what it cost', async () => {
    const state = {
      history: [
        job('FAILED', { id: OLD_JOB, errorCode: 'QUEUE_EXPIRED', completedAt: at, description: null, requesterName: 'Luis Gómez' }),
        job('FAILED', { errorCode: 'CANCELLED', completedAt: at, cancelledByName: 'Luis Gómez', tokens: 9_000 }),
      ],
    };
    renderRoute(url, { handlers: aiApi(state), realtime: fakeRealtime().client });
    const history = await within(await openPanel()).findByRole('list', { name: 'Solicitudes a la IA de este borrador' });
    const [first, second] = within(history).getAllByRole('listitem').filter((item) => item.textContent !== '');
    expect(first).toHaveTextContent('Luis Gómez');
    expect(first).toHaveTextContent('La descripción de esta solicitud ya no se guarda.');
    expect(first).toHaveTextContent('El asistente no alcanzó a atender la solicitud. Inténtalo de nuevo más tarde.');
    expect(second).toHaveTextContent('Ana Torres');
    expect(second).toHaveTextContent(DESCRIPTION);
    expect(second).toHaveTextContent('Cancelada por Luis Gómez.');
    expect(second).toHaveTextContent('9.000 tokens');
  });

  it('builds the diagram on the canvas while the AI designs, and gives the draft back when the request fails', async () => {
    const preview = {
      steps: [
        { ref: 'inicio', type: 'START', name: 'Solicitud de anticipo' },
        { ref: 'jefe', type: 'APPROVAL', name: 'Aprobación del jefe' },
      ],
      transitions: [{ from: 'inicio', to: 'jefe', label: 'Enviar' }],
    };
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const panel = this.matches('[aria-label="Crear el flujo con IA"]');
      return { left: panel ? 600 : 0, right: 1000, top: 0, bottom: 600, width: panel ? 400 : 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    onTestFinished(() => measure.mockRestore());
    const state = { history: [job('RUNNING', { startedAt: at, stage: 'DESIGNING', round: 1, preview: { steps: [], transitions: [] } })] };
    const realtime = fakeRealtime();
    renderRoute(url, { handlers: aiApi(state), realtime: realtime.client });
    const region = await openPanel();
    await within(region).findAllByText('La IA está diseñando el flujo (ronda 1)…');
    expect(screen.queryByText(/La IA está armando el flujo/)).not.toBeInTheDocument();

    state.history = [job('RUNNING', { startedAt: at, stage: 'DESIGNING', round: 1, preview })];
    realtime.fire();
    const banner = await screen.findByText('La IA está armando el flujo… 2 bloques');
    // Centred in the part of the canvas the open panel leaves free (the canvas ends at 1000 px, the panel starts at 600).
    expect(banner).toHaveStyle({ left: 'calc(50% - 200px)' });
    expect(screen.getByText('Solicitud de anticipo')).toBeInTheDocument();
    expect(screen.getByText('Aprobación del jefe')).toBeInTheDocument();
    expect(within(region).getByText('Míralo armarse en el lienzo.')).toBeInTheDocument();

    state.history = [job('FAILED', { errorCode: 'AI_DRAFT_INVALID', startedAt: at, completedAt: at })];
    realtime.fire();
    await vi.waitFor(() => expect(screen.queryByText(/La IA está armando el flujo/)).not.toBeInTheDocument());
    expect(screen.queryByText('Solicitud de anticipo')).not.toBeInTheDocument();
  });

  it('stays in full screen when the draft from the AI arrives (the builder starts over on it)', async () => {
    let holder: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => holder });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value(this: HTMLElement) {
        holder = this;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      },
    });
    onTestFinished(() => {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
    });
    const done = { revision: 1, assumptions: [], decisions: [], outline: null, corrections: 0, rounds: 1, errors: 0, warnings: 0 };
    const state = { history: [job('RUNNING', { startedAt: at, stage: 'DESIGNING', round: 1 })] };
    const realtime = fakeRealtime();
    renderRoute(url, { handlers: aiApi(state, undefined, aiDraftDoc()), realtime: realtime.client });
    await openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Pantalla completa' }));
    expect(screen.getByRole('button', { name: 'Salir de pantalla completa' })).toBeInTheDocument();

    state.history = [job('SUCCEEDED', { completedAt: at, result: done })];
    realtime.fire();
    expect(await screen.findByText(/La IA armó el borrador|La IA actualizó el borrador/)).toBeInTheDocument();
    expect(holder).not.toBeNull();
    expect(holder!.isConnected).toBe(true);
    expect(holder!.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
    expect(screen.getByRole('button', { name: 'Salir de pantalla completa' })).toBeInTheDocument();
  });

  it('cancels the request in progress', async () => {
    const state = { history: [job('RUNNING', { startedAt: at, stage: 'DESIGNING', round: 1 })] };
    const { fake } = renderRoute(url, { handlers: aiApi(state), realtime: fakeRealtime().client });
    const region = await openPanel();
    await userEvent.click(await within(region).findByRole('button', { name: 'Cancelar la solicitud' }));
    expect(fake.callsTo(`/ai-jobs/${JOB}/cancel`)).toHaveLength(1);
    expect(await within(region).findByText('Cancelada por Luis Gómez.')).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Cancelar la solicitud' })).not.toBeInTheDocument();
  });

  it('comes back open after a reload, still showing the request in progress', async () => {
    window.sessionStorage.setItem(`procesabpm.builder.ai.${DRAFT}`, 'open');
    renderRoute(url, { handlers: aiApi({ history: [job('RUNNING', { startedAt: at, stage: 'READING' })] }), realtime: fakeRealtime().client });
    expect(await within(await screen.findByRole('region', { name: 'Crear el flujo con IA' })).findAllByText(/Leyendo los cargos, grupos y tipos de aprobación/)).not.toHaveLength(0);
    await userEvent.click(within(panel()).getByRole('button', { name: 'Cerrar el panel de IA' }));
    expect(window.sessionStorage.getItem(`procesabpm.builder.ai.${DRAFT}`)).toBeNull();
  });

  it('polls a request in progress when there is no socket', async () => {
    const state = { history: [job('RUNNING', { startedAt: at, stage: 'DESIGNING', round: 1 })] };
    const { fake } = renderRoute(url, { handlers: aiApi(state) });
    await openPanel();
    await within(panel()).findAllByText('La IA está diseñando el flujo (ronda 1)…');
    state.history = [job('FAILED', { errorCode: 'DRAFT_CHANGED', completedAt: at })];
    expect(await within(panel()).findByText('Alguien cambió el borrador mientras la IA trabajaba: no se reemplazó.', {}, { timeout: 8_000 })).toBeInTheDocument();
    expect(fake.callsTo(historyUrl).length).toBeGreaterThan(1);
  }, 15_000);

  it('holds the message while the draft has unsaved changes', async () => {
    renderRoute(url, { handlers: aiApi({ history: [] }), realtime: fakeRealtime().client });
    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar Paso' }));
    const region = await openPanel();
    expect(within(region).getByText(/Guarda los cambios antes de escribirle a la IA/)).toBeInTheDocument();
    await userEvent.type(within(region).getByRole('textbox', { name: /Cambio al borrador/ }), 'agrega una revisión jurídica');
    expect(within(region).getByRole('button', { name: 'Pedir el cambio' })).toBeDisabled();
  });

  it('asks for a change to a draft with content by default, shows the kind of each turn, and can start over instead', async () => {
    const CHANGE = 'agrega una revisión jurídica después de gerencia';
    const created = { revision: 1, assumptions: [], decisions: [], outline: null, corrections: 0, rounds: 1, errors: 0, warnings: 0 };
    const state = { history: [job('SUCCEEDED', { id: OLD_JOB, completedAt: at, result: created })] };
    const realtime = fakeRealtime();
    // Browsers where scrolling returns a promise: the panel must not hand it to React as a cleanup (it crashed on the next turn).
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => Promise.resolve() });
    onTestFinished(() => void Reflect.deleteProperty(Element.prototype, 'scrollIntoView'));
    const { fake } = renderRoute(url, { handlers: aiApi(state, undefined, aiDraftDoc()), realtime: realtime.client });
    const region = await openPanel();
    expect(within(region).queryByText(/se reemplazará por completo/)).not.toBeInTheDocument();
    expect(within(region).getByText(/conserva el resto del borrador/)).toBeInTheDocument();
    await userEvent.type(within(region).getByRole('textbox', { name: /Cambio al borrador/ }), CHANGE);
    await userEvent.click(within(region).getByRole('button', { name: 'Pedir el cambio' }));
    expect(fake.callsTo(`${url}/ai-draft`)[0]?.options.body).toEqual({ mode: 'REVISE', description: CHANGE, revision: 1 });

    const history = await within(region).findByRole('list', { name: 'Solicitudes a la IA de este borrador' });
    const [first, second] = await vi.waitFor(() => {
      const items = within(history).getAllByRole('listitem').filter((item) => item.textContent !== '');
      expect(items).toHaveLength(2);
      return items;
    });
    expect(first).toHaveTextContent('Borrador nuevo');
    expect(second).toHaveTextContent('Cambio al borrador');
    expect(second).toHaveTextContent(CHANGE);

    const changed = { ...created, revision: 2, decisions: [{ topic: 'STEPS', text: 'Agregué la revisión jurídica después de gerencia.' }] };
    state.history = [state.history[0]!, job('SUCCEEDED', { kind: 'WORKFLOW_DRAFT_REVISION', description: CHANGE, completedAt: at, result: changed })];
    realtime.fire();
    expect(await screen.findByText(/La IA actualizó el borrador/)).toBeInTheDocument();
    const answer = panel();
    expect(await within(answer).findByText('Cambio aplicado en 1 ronda.')).toBeInTheDocument();
    expect(within(answer).getByText('Lo que cambió (1)')).toBeVisible();
    // The builder arranged the revised draft and saved that on its own: the next message can go right away.
    await vi.waitFor(() => expect(screen.getByText('Todo guardado')).toBeInTheDocument());
    expect(within(answer).queryByText(/Guarda los cambios antes de escribirle a la IA/)).not.toBeInTheDocument();
    expect(fake.callsTo(`${url}/graph`)).toHaveLength(1);

    await userEvent.click(within(answer).getByRole('button', { name: 'Empezar de cero' }));
    expect(within(answer).getByRole('textbox', { name: /Descripción del proceso/ })).toBeInTheDocument();
    expect(within(answer).getByText(/se reemplazará por completo/)).toBeInTheDocument();
    expect(within(answer).getByRole('button', { name: 'Armar el borrador' })).toBeInTheDocument();
    await userEvent.click(within(answer).getByRole('button', { name: 'Volver a pedir cambios' }));
    expect(within(answer).getByRole('textbox', { name: /Cambio al borrador/ })).toBeInTheDocument();
  }, 20_000);

  it('explains a change refused because the AI cannot keep everything the draft has, and what', async () => {
    const refuse: FakeHandler = () => {
      throw new ApiError({
        status: 422,
        code: 'AI_DRAFT_NOT_REVISABLE',
        message: 'x',
        details: { losses: [{ subject: 'STEP', name: 'Pagar anticipo', properties: ['closeRule', 'files'] }, { subject: 'FIELD', name: 'Monto', properties: ['config.unheardOf'] }] },
      });
    };
    renderRoute(url, { handlers: aiApi({ history: [] }, refuse, aiDraftDoc()), realtime: fakeRealtime().client });
    const region = await openPanel();
    await userEvent.type(within(region).getByRole('textbox', { name: /Cambio al borrador/ }), 'quita el pago');
    await userEvent.click(within(region).getByRole('button', { name: 'Pedir el cambio' }));
    expect(await within(region).findByText(/La IA no puede cambiar este borrador sin perder parte de lo que tiene/)).toBeInTheDocument();
    expect(within(region).getByText('Paso «Pagar anticipo»: permite cerrar el ticket, archivos adjuntos')).toBeInTheDocument();
    expect(within(region).getByText('Campo «Monto»: otra configuración')).toBeInTheDocument();
  });

  it('explains a refused request, like the daily limit', async () => {
    const refuse: FakeHandler = () => {
      throw new ApiError({ status: 422, code: 'AI_DAILY_LIMIT_REACHED', message: 'x', details: { resetsAt: '2026-10-22T05:00:00.000Z' } });
    };
    renderRoute(url, { handlers: aiApi({ history: [] }, refuse), realtime: fakeRealtime().client });
    const region = await openPanel();
    await describeProcess(region);
    expect(await within(region).findByText(/La organización llegó al límite de hoy\. Se renueva el/)).toBeInTheDocument();
  });
});

describe('«Importar plantilla» in the builder', () => {
  const template = { assumptions: [], steps: [], transitions: [], fields: [] };
  const file = (text: string) => new File([text], 'plantilla.json', { type: 'application/json' });
  const upload = async (text: string) => userEvent.upload(await screen.findByLabelText('Archivo de la plantilla (JSON)'), file(text));

  it('sends the template with the revision and opens the replaced draft', async () => {
    const base = api();
    let imported = false;
    const { fake } = renderRoute(url, {
      handlers: {
        ...base,
        [url]: (options, path) => {
          const detail = base[url]!(options, path) as Record<string, unknown>;
          return imported ? { ...detail, version: versionOf('DRAFT', 1), document: { ...startingDoc(), steps: [step(START, 'START', 'Inicio'), step(id(96), 'TASK', 'Revisar plantilla'), step(END, 'END', 'Fin')] } } : detail;
        },
        [`${url}/import`]: () => {
          imported = true;
          return { revision: 1, errors: 0, warnings: 0 };
        },
      },
    });
    await upload(JSON.stringify(template));
    expect(await screen.findByText('Se importó la plantilla. Revisa el borrador antes de publicar.')).toBeInTheDocument();
    expect(fake.callsTo(`${url}/import`)[0]?.options.body).toEqual({ revision: 0, spec: template });
    expect(await within(outline()).findByRole('button', { name: /Revisar plantilla/ })).toBeInTheDocument();
  });

  it('explains a file that is not JSON and a template that does not fit the organization', async () => {
    const { fake } = renderRoute(url, {
      handlers: {
        ...api(),
        [`${url}/import`]: () => {
          throw new ApiError({ status: 400, code: 'VALIDATION_FAILED', message: 'x', details: { problems: [{ code: 'UNKNOWN_POSITION' }] } });
        },
      },
    });
    await upload('{ no es json');
    const dialog = await screen.findByRole('dialog', { name: 'No se pudo importar la plantilla' });
    expect(within(dialog).getByText('El archivo no es un JSON válido.')).toBeInTheDocument();
    expect(fake.callsTo(`${url}/import`)).toHaveLength(0);
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Cerrar' })[0]!);

    await upload(JSON.stringify(template));
    expect(await screen.findByText(/nombra cargos, grupos, tipos de aprobación o bloques que no existen/)).toBeInTheDocument();
  });
});
