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
        { id: id(50), stepId: START, code: 'AMOUNT', label: 'Monto', type: 'CURRENCY', capture: 'CREATION', isRequired: true, isReadOnly: false, sortOrder: 0, config: {}, dataSource: null },
        { id: id(51), stepId: START, code: 'PAYMENT_TYPE', label: 'Tipo de pago', type: 'SELECT', capture: 'CREATION', isRequired: true, isReadOnly: false, sortOrder: 1, config: { options: [{ value: 'cash', label: 'Efectivo' }, { value: 'transfer', label: 'Transferencia' }] }, dataSource: null },
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
