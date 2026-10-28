import type { StepDocument, TransitionDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
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
  const PAY = id(96);
  const availability = `/ai-assistant/availability`;
  const job = (status: string, overrides: Record<string, unknown> = {}) => ({ id: JOB, status, errorCode: null, result: null, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, ...overrides });
  const aiDraftDoc = (): WorkflowVersionDocument => ({
    ...startingDoc(),
    steps: [step(START, 'START', 'Inicio'), step(PAY, 'TASK', 'Pagar anticipo'), step(END, 'END', 'Fin')],
    transitions: [link(id(97), START, PAY), link(id(98), PAY, END, { type: 'DECISION', label: 'Pagado' })],
  });
  /** The builder's API plus the assistant: the version is rewritten on the server once the request succeeds. */
  function aiApi(jobs: Array<ReturnType<typeof job>>, request: FakeHandler = () => ({ jobId: JOB })) {
    const base = api();
    let written = false;
    return {
      ...base,
      [url]: (options: Parameters<FakeHandler>[0], path: string) => {
        const detail = base[url]!(options, path) as Record<string, unknown>;
        return written ? { ...detail, version: versionOf('DRAFT', 1), document: aiDraftDoc() } : detail;
      },
      [availability]: () => ({ available: true, remainingJobsToday: 4, activeJobId: null }),
      [`${url}/ai-draft`]: request,
      [`/ai-jobs/${JOB}`]: () => {
        const next = jobs.length > 1 ? jobs.shift()! : jobs[0]!;
        if (next.status === 'SUCCEEDED') written = true;
        return next;
      },
    };
  }
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Crear con IA' }));
    return screen.getByRole('dialog', { name: 'Crear el flujo con IA' });
  };
  const describeProcess = async (dialog: HTMLElement) => {
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Descripción del proceso/ }), 'El asesor pide un anticipo y tesorería lo paga.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Armar el borrador' }));
  };

  it('is not offered while the organization has the assistant off', async () => {
    renderRoute(url, { handlers: { ...api(), [availability]: () => ({ available: false, remainingJobsToday: 0, activeJobId: null }) } });
    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    expect(screen.queryByRole('button', { name: 'Crear con IA' })).not.toBeInTheDocument();
  });

  it('sends the description with the revision, shows the wait, and opens the new draft with what the AI assumed', async () => {
    const result = { revision: 1, assumptions: ['Tesorería paga por transferencia.'], rounds: 1, errors: 0, warnings: 0 };
    const { fake } = renderRoute(url, { handlers: aiApi([job('RUNNING', { startedAt: at }), job('SUCCEEDED', { result })]) });
    const dialog = await openDialog();
    expect(within(dialog).getByText('Quedan 4 solicitudes hoy para la organización.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Armar el borrador' })).toBeDisabled();
    await describeProcess(dialog);

    expect(fake.callsTo(`${url}/ai-draft`)[0]?.options.body).toEqual({ description: 'El asesor pide un anticipo y tesorería lo paga.', revision: 0 });
    expect(await within(dialog).findByText('La IA está armando el flujo…')).toBeInTheDocument();

    expect(await screen.findByText(/La IA armó el borrador\. Revísalo antes de publicar\./, {}, { timeout: 6_000 })).toBeInTheDocument();
    expect(screen.getByText('Tesorería paga por transferencia.')).toBeInTheDocument();
    expect(await within(outline()).findByRole('button', { name: /Pagar anticipo/ })).toBeInTheDocument();
  }, 15_000);

  it('says why a request ended without a draft, and goes back to the form to try again', async () => {
    renderRoute(url, { handlers: aiApi([job('FAILED', { errorCode: 'DRAFT_CHANGED', completedAt: at })]) });
    const dialog = await openDialog();
    await describeProcess(dialog);
    expect(await within(dialog).findByText('Alguien cambió el borrador mientras la IA trabajaba: no se reemplazó.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Intentar de nuevo' }));
    expect(within(dialog).getByRole('textbox', { name: /Descripción del proceso/ })).toBeInTheDocument();
  });

  it('explains a refused request, like the daily limit', async () => {
    const refuse: FakeHandler = () => {
      throw new ApiError({ status: 422, code: 'AI_DAILY_LIMIT_REACHED', message: 'x', details: { resetsAt: '2026-10-22T05:00:00.000Z' } });
    };
    renderRoute(url, { handlers: aiApi([job('PENDING')], refuse) });
    const dialog = await openDialog();
    await describeProcess(dialog);
    expect(await within(dialog).findByText(/La organización llegó al límite de hoy\. Se renueva el/)).toBeInTheDocument();
  });
});
