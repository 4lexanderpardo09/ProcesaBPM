import type { AmountRuleDocument, FieldDocument, StepDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';
import { at, END, field, FLOW, id, link, page, START, startingDoc, step, versionOf, versionUrl as url } from '../test/builder-fixtures';

const TASK = id(33);
const APPROVAL = id(34);
const POSITION = id(60);
const GROUP = id(61);
const COMPANY = id(62);

const withTask = (overrides: Partial<StepDocument> = {}): WorkflowVersionDocument => ({
  steps: [step(START, 'START', 'Inicio'), step(TASK, 'TASK', 'Revisar pago', { assignmentMode: 'CREATOR', ...overrides }), step(END, 'END', 'Fin')],
  transitions: [link(id(40), START, TASK), link(id(41), TASK, END, { type: 'DECISION' })],
  fields: [],
  amountRules: [],
});

/** A fake API that keeps fields, the lists of each block and the amount rules, as the draft editor does. */
function api(initial: WorkflowVersionDocument) {
  let document = initial;
  let ids = 200;
  const next = () => id((ids += 1));
  const children = (stepId: string) => {
    const found = document.steps.find((candidate) => candidate.id === stepId)!;
    return { candidates: found.candidates, initiators: found.initiators, signers: found.signers, slaOverrides: found.slaOverrides, files: found.files };
  };
  const replaceStep = (stepId: string, patch: Partial<StepDocument>) => {
    document = { ...document, steps: document.steps.map((candidate) => (candidate.id === stepId ? { ...candidate, ...patch } : candidate)) };
    return children(stepId);
  };
  const handlers: Record<string, FakeHandler> = {
    [url]: () => ({ workflow: { id: FLOW, name: 'Confirmación de pagos', subcategoryId: id(11) }, version: versionOf('DRAFT'), document, validation: null }),
    [`${url}/graph`]: (request) => {
      const body = request.body as { revision: number };
      return { revision: body.revision + 1, idMap: {}, document, validation: { errors: [], warnings: [] } };
    },
    [`${url}/fields`]: (request) => {
      const body = request.body as Omit<FieldDocument, 'id'>;
      if (document.fields.some((candidate) => candidate.code === body.code)) throw new ApiError({ status: 409, code: 'DUPLICATE', message: 'x' });
      const created = { ...body, id: next() } as FieldDocument;
      document = { ...document, fields: [...document.fields, created] };
      return created;
    },
    [`${url}/amount-rules`]: (request) => {
      const created = { id: next(), ...(request.body as object) } as AmountRuleDocument;
      document = { ...document, amountRules: [...document.amountRules, created] };
      return created;
    },
    '/groups': () => page([{ id: GROUP, name: 'Tesorería', isActive: true, createdAt: at }]),
    '/positions': () => page([{ id: POSITION, name: 'Analista de cartera', isActive: true, createdAt: at }]),
    '/companies': () => page([{ id: COMPANY, name: 'Electrocréditos', taxId: null, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', calendarId: null, isDefault: true, isActive: true, createdAt: at }]),
    '/departments': () => page([]),
    '/sites': () => page([]),
    '/datasets': () => page([]),
    '/approval-group-types': () => page([]),
    '/members/directory': () => [],
    '/workflows': () => page([]),
  };
  for (const stepId of [START, TASK, APPROVAL]) {
    handlers[`${url}/steps/${stepId}/initiators`] = (request) =>
      replaceStep(stepId, { initiators: (request.body as { initiators: Array<Record<string, string>> }).initiators.map((row) => ({ id: next(), userId: null, positionId: null, groupId: null, departmentId: null, companyId: null, siteId: null, ...row })) as unknown as StepDocument['initiators'] });
    handlers[`${url}/steps/${stepId}/candidates`] = (request) =>
      replaceStep(stepId, { candidates: (request.body as { candidates: Array<Record<string, string>> }).candidates.map((row) => ({ id: next(), userId: null, positionId: null, groupId: null, ...row })) as unknown as StepDocument['candidates'] });
    handlers[`${url}/steps/${stepId}/signers`] = (request) =>
      replaceStep(stepId, {
        signers: (request.body as { signers: Array<Record<string, string | null>> }).signers.map((row, index) => ({ id: next(), userId: null, positionId: null, label: null, ...row, sortOrder: index })) as unknown as StepDocument['signers'],
      });
    handlers[`${url}/steps/${stepId}/sla-overrides`] = (request) => replaceStep(stepId, { slaOverrides: (request.body as { overrides: StepDocument['slaOverrides'] }).overrides });
  }
  const fieldHandler: FakeHandler = (request, path) => {
    const fieldId = path.split('/').at(-1)!;
    if (request.method === 'DELETE') {
      document = { ...document, fields: document.fields.filter((candidate) => candidate.id !== fieldId) };
      return undefined;
    }
    document = { ...document, fields: document.fields.map((candidate) => (candidate.id === fieldId ? { ...candidate, ...(request.body as object) } : candidate)) };
    return document.fields.find((candidate) => candidate.id === fieldId);
  };
  return { handlers, fieldHandler, document: () => document };
}

const inspector = () => screen.getByRole('complementary', { name: 'Propiedades' });
const section = (name: string) => within(inspector()).getByRole('region', { name });
const openBlock = async (name: string) => {
  await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Bloques del flujo' })).getByRole('button', { name }));
};

describe('workflow content', () => {
  // Long typing in jsdom: on a loaded machine it can pass the default 5 s.
  it('adds a field to the start with a code from its name, and the next canvas save carries the new revision', async () => {
    const fake = api(startingDoc());
    const { fake: transport } = renderRoute(url, { handlers: fake.handlers });

    await openBlock('Inicio: Inicio');
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Agregar campo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo campo' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Nombre/ }), 'Monto total');
    expect(within(dialog).getByRole('textbox', { name: /^Código/ })).toHaveValue('MONTO_TOTAL');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Tipo' }), 'Moneda');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Obligatorio' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar campo' }));

    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo campo' })).not.toBeInTheDocument());
    expect(transport.callsTo(`${url}/fields`)[0]?.options.body).toEqual({
      stepId: START,
      code: 'MONTO_TOTAL',
      label: 'Monto total',
      type: 'CURRENCY',
      capture: 'CREATION',
      isRequired: true,
      isReadOnly: false,
      sortOrder: 0,
      config: { currencyCode: 'COP' },
      dataSource: null,
    });
    const list = within(inspector()).getByRole('list', { name: 'Campos del bloque' });
    expect(within(list).getByText('Monto total')).toBeInTheDocument();
    expect(within(list).getByText('MONTO_TOTAL · Moneda')).toBeInTheDocument();
    // A field edit is not unsaved canvas work, but it moved the revision: the next save says 1.
    expect(screen.getByText('Todo guardado')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar Fin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect((transport.callsTo(`${url}/graph`)[0]?.options.body as { revision: number }).revision).toBe(1));
  }, 15_000);

  it('explains what a list field is missing before sending it, and says when the code is taken', async () => {
    const fake = api({ ...startingDoc(), fields: [field(id(70), START, 'TIPO', 'Tipo de pago', 'TEXT')] });
    const { fake: transport } = renderRoute(url, { handlers: fake.handlers });

    await openBlock('Inicio: Inicio');
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Agregar campo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo campo' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Nombre/ }), 'Medio');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Tipo' }), 'Lista (una opción)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar campo' }));
    expect(within(dialog).getByText('Cada opción necesita su valor y su texto.')).toBeInTheDocument();
    expect(transport.callsTo(`${url}/fields`)).toHaveLength(0);

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Texto que se ve' }), 'Efectivo');
    expect(within(dialog).getByRole('textbox', { name: 'Valor' })).toHaveValue('Efectivo');
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /^Código/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Código/ }), 'TIPO');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar campo' }));
    expect(within(dialog).getByText('Otro campo de esta versión ya usa este código.')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByRole('textbox', { name: /^Código/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Código/ }), 'MEDIO');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar campo' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/fields`)[0]?.options.body).toMatchObject({ code: 'MEDIO', type: 'SELECT', config: { options: [{ value: 'Efectivo', label: 'Efectivo' }] } }));
  });

  it('offers a list field only the Excel files this workflow may use, and reads a column of the chosen one', async () => {
    const fake = api(startingDoc());
    const excel = (datasetId: string, name: string, workflowId: string | null) => ({ id: datasetId, name, workflowId, columns: [{ name: 'Banco', isKey: false }], keyColumn: null, rowCount: 3, sourceFileName: null, loadedAt: at, isActive: true });
    const { fake: transport } = renderRoute(url, { handlers: { ...fake.handlers, '/datasets': () => page([excel(id(80), 'Bancos', null), excel(id(81), 'Sedes de este flujo', FLOW), excel(id(82), 'De otro flujo', id(99))]) } });

    await openBlock('Inicio: Inicio');
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Agregar campo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo campo' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Nombre/ }), 'Banco');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Tipo' }), 'Lista (una opción)');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'De dónde salen las opciones' }), 'Una columna de un Excel cargado');
    const excelChoice = await within(dialog).findByRole('combobox', { name: 'Excel' });
    expect(within(excelChoice).getAllByRole('option').map((option) => option.textContent)).toEqual(['Elige un Excel', 'Bancos', 'Sedes de este flujo']);
    await userEvent.selectOptions(excelChoice, 'Bancos');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Columna' }), 'Banco');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar campo' }));

    await vi.waitFor(() => expect(transport.callsTo(`${url}/fields`)[0]?.options.body).toMatchObject({ code: 'BANCO', type: 'SELECT', dataSource: { kind: 'DATASET', datasetId: id(80), column: 'Banco' } }));
  }, 15_000);

  it('edits a field without its code or type, moves it down and takes another out', async () => {
    const fake = api({
      ...startingDoc(),
      fields: [field(id(70), START, 'MONTO', 'Monto', 'NUMBER', { sortOrder: 0 }), field(id(71), START, 'NOTAS', 'Notas', 'TEXTAREA', { sortOrder: 1 })],
    });
    fake.handlers[`${url}/fields/${id(70)}`] = fake.fieldHandler;
    fake.handlers[`${url}/fields/${id(71)}`] = fake.fieldHandler;
    const { fake: transport } = renderRoute(url, { handlers: fake.handlers });

    await openBlock('Inicio: Inicio');
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Editar el campo Monto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar campo' });
    expect(within(dialog).getByRole('textbox', { name: /^Código/ })).toHaveAttribute('readonly');
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Máximo' }), '1000000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar campo' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/fields/${id(70)}`)[0]?.options.body).toMatchObject({ label: 'Monto', config: { max: 1000000 } }));

    await userEvent.click(within(inspector()).getByRole('button', { name: 'Bajar Monto' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/fields/${id(71)}`).length).toBeGreaterThan(0));
    expect(transport.callsTo(`${url}/fields/${id(70)}`).at(-1)?.options.body).toEqual({ sortOrder: 1 });
    expect(transport.callsTo(`${url}/fields/${id(71)}`).at(-1)?.options.body).toEqual({ sortOrder: 0 });
    await vi.waitFor(() => expect(within(within(inspector()).getByRole('list', { name: 'Campos del bloque' })).getAllByRole('listitem').map((item) => item.textContent?.slice(0, 5))).toEqual(['Notas', 'Monto']));

    await userEvent.click(within(inspector()).getByRole('button', { name: 'Quitar el campo Notas' }));
    const confirm = await screen.findByRole('dialog', { name: 'Quitar campo' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Quitar' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/fields/${id(71)}`).at(-1)?.options.method).toBe('DELETE'));
    await vi.waitFor(() => expect(within(inspector()).queryByText('Notas')).not.toBeInTheDocument());
  });

  it('asks to save a block that is new before giving it fields or participants', async () => {
    renderRoute(url, { handlers: api(startingDoc()).handlers });

    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar Paso' }));

    expect(within(inspector()).getByText(/Guarda los cambios del lienzo para configurar/)).toBeInTheDocument();
    expect(within(inspector()).queryByRole('button', { name: 'Agregar campo' })).not.toBeInTheDocument();
  });

  it('limits who may create tickets from the start, and gives a pool its candidates and a deadline per company', async () => {
    const fake = api(withTask({ assignmentMode: 'POOL' }));
    const { fake: transport } = renderRoute(url, { handlers: fake.handlers });

    await openBlock('Inicio: Inicio');
    const initiators = section('Quién puede crear tickets');
    expect(within(initiators).getByText('Cualquier persona de la organización.')).toBeInTheDocument();
    await userEvent.selectOptions(within(initiators).getByRole('combobox', { name: 'Tipo' }), 'Grupo');
    await userEvent.selectOptions(await within(initiators).findByRole('combobox', { name: 'Cuál' }), 'Tesorería');
    await userEvent.click(within(initiators).getByRole('button', { name: 'Agregar' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/steps/${START}/initiators`)[0]?.options.body).toEqual({ initiators: [{ participantType: 'GROUP', groupId: GROUP }] }));
    expect(await within(within(inspector()).getByRole('list', { name: 'Quién puede crear tickets' })).findByText('Tesorería')).toBeInTheDocument();

    await openBlock('Paso: Revisar pago');
    const candidates = section('Candidatos');
    await userEvent.selectOptions(within(candidates).getByRole('combobox', { name: 'Tipo' }), 'Cargo');
    await userEvent.selectOptions(await within(candidates).findByRole('combobox', { name: 'Cuál' }), 'Analista de cartera');
    await userEvent.click(within(candidates).getByRole('button', { name: 'Agregar' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/steps/${TASK}/candidates`)[0]?.options.body).toEqual({ candidates: [{ participantType: 'POSITION', positionId: POSITION }] }));

    const perCompany = section('Plazo por empresa');
    await userEvent.selectOptions(await within(perCompany).findByRole('combobox', { name: 'Empresa' }), 'Electrocréditos');
    await userEvent.type(within(perCompany).getByRole('textbox', { name: 'Plazo para esa empresa' }), '3');
    await userEvent.click(within(perCompany).getByRole('button', { name: 'Agregar' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/steps/${TASK}/sla-overrides`)[0]?.options.body).toEqual({ overrides: [{ companyId: COMPANY, slaValue: 3, slaUnit: 'BUSINESS_DAYS' }] }));
    expect(await within(inspector()).findByText('Electrocréditos: 3 días hábiles')).toBeInTheDocument();
  });

  it('lists who signs, in order', async () => {
    const fake = api(withTask({ type: 'SIGNATURE', name: 'Firma de gerencia', config: { document: 'MAIN_DOCUMENT' } }));
    const { fake: transport } = renderRoute(url, { handlers: fake.handlers });

    await openBlock('Firma: Firma de gerencia');
    const signers = () => section('Firmantes');
    await userEvent.selectOptions(within(signers()).getByRole('combobox', { name: 'Tipo' }), 'Quien creó el ticket');
    await userEvent.click(within(signers()).getByRole('button', { name: 'Agregar' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/steps/${TASK}/signers`)).toHaveLength(1));
    await userEvent.selectOptions(within(signers()).getByRole('combobox', { name: 'Tipo' }), 'El aprobador');
    await userEvent.type(within(signers()).getByRole('textbox', { name: 'Rótulo en el documento (opcional)' }), 'Aprobó');
    await userEvent.click(within(signers()).getByRole('button', { name: 'Agregar' }));

    await vi.waitFor(() =>
      expect(transport.callsTo(`${url}/steps/${TASK}/signers`)[1]?.options.body).toEqual({
        signers: [
          { signerType: 'CREATOR', label: null },
          { signerType: 'APPROVER', label: 'Aprobó' },
        ],
      }),
    );
    const list = await within(inspector()).findByRole('list', { name: 'Firmantes' });
    expect(within(list).getByText('2. El aprobador')).toBeInTheDocument();
  });

  it('a notification names specific groups among its recipients, in its own settings', async () => {
    const doc = withTask();
    const notify = step(id(35), 'NOTIFICATION', 'Avisar a tesorería', { config: { recipients: [{ kind: 'CREATOR' }], channels: ['IN_APP'], subject: 'Pago', body: '' } });
    const { fake: transport } = renderRoute(url, { handlers: api({ ...doc, steps: [...doc.steps, notify], transitions: [...doc.transitions, link(id(42), notify.id, END)] }).handlers });

    await openBlock('Notificación: Avisar a tesorería');
    const notification = section('Notificación');
    await userEvent.selectOptions(within(notification).getByRole('combobox', { name: 'Tipo' }), 'Grupo');
    await userEvent.selectOptions(await within(notification).findByRole('combobox', { name: 'Cuál' }), 'Tesorería');
    await userEvent.click(within(notification).getByRole('button', { name: 'Agregar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(transport.callsTo(`${url}/graph`)).toHaveLength(1));
    const saved = (transport.callsTo(`${url}/graph`)[0]?.options.body as { steps: Array<{ name: string; config: Record<string, unknown> }> }).steps.find((candidate) => candidate.name === 'Avisar a tesorería');
    expect(saved?.config.recipients).toEqual([{ kind: 'CREATOR' }, { kind: 'GROUP', id: GROUP }]);
  });

  it('adds an amount cap that asks for an extra approval, and wires the approval for the engine', async () => {
    const doc = withTask();
    const approval = step(APPROVAL, 'APPROVAL', 'Aprobación de gerencia', { assignmentMode: 'CREATOR' });
    const initial: WorkflowVersionDocument = {
      ...doc,
      steps: [...doc.steps, approval],
      transitions: [...doc.transitions, link(id(43), APPROVAL, END, { type: 'DECISION', label: 'Aprobar' })],
      fields: [field(id(70), START, 'MONTO', 'Monto', 'CURRENCY')],
    };
    const { fake: transport } = renderRoute(url, { handlers: api(initial).handlers });

    await screen.findByRole('heading', { level: 1, name: 'Confirmación de pagos' });
    await userEvent.click(screen.getByRole('button', { name: 'Topes de monto' }));
    let dialog = await screen.findByRole('dialog', { name: 'Topes de monto' });
    expect(within(dialog).getByText('Este flujo no tiene topes de monto.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar tope' }));
    dialog = await screen.findByRole('dialog', { name: 'Nuevo tope de monto' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Campo con el monto' }), 'Monto (MONTO)');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Tope/ }), '5000000');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Si se pasa' }), 'Pedir una aprobación extra');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar tope' }));
    expect(within(dialog).getByText(/Una aprobación extra se revisa en un paso/)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Dónde se revisa' }), 'Revisar pago');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Aprobación extra' }), 'Aprobación de gerencia');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar tope' }));

    await vi.waitFor(() =>
      expect(transport.callsTo(`${url}/amount-rules`)[0]?.options.body).toEqual({
        fieldCode: 'MONTO',
        maxAmount: '5000000',
        currencyCode: 'COP',
        action: 'EXTRA_APPROVAL',
        stepId: TASK,
        approvalStepId: APPROVAL,
        positionId: null,
        companyId: null,
        amountColumn: null,
        typeColumn: null,
        rowTypeValue: null,
        message: null,
        isActive: true,
      }),
    );
    dialog = await screen.findByRole('dialog', { name: 'Topes de monto' });
    expect(within(dialog).getByText('Monto hasta 5.000.000 COP: Pedir una aprobación extra')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear la conexión del sistema de Revisar pago a Aprobación de gerencia' }));
    expect(within(dialog).queryByRole('button', { name: /Crear la conexión/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Cerrar' }).at(-1)!);

    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(transport.callsTo(`${url}/graph`)).toHaveLength(1));
    const transitions = (transport.callsTo(`${url}/graph`)[0]?.options.body as { transitions: Array<{ type: string; fromStepId: string; toStepId: string; label: string }> }).transitions;
    expect(transitions.find((transition) => transition.type === 'SYSTEM_ONLY')).toMatchObject({ fromStepId: TASK, toStepId: APPROVAL, label: 'Aprobación extra por monto' });
  });
});
