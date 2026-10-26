import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { fakeProfile } from '@/test/fake-profile';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';
import { typeInEditor } from '@/test/rich-text-editor';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const MAIN = id(10);
const BRANCH = id(11);
const CARTERA = id(20);
const PAGOS = id(21);
const OTRA = id(22);
const START = id(30);
const HIGH = id(40);
const MEDIUM = id(41);
const NEW_TICKET = id(50);

const profile =
  (companies: ReadonlyArray<{ id: string; name: string; isDefault: boolean }>): FakeHandler =>
  (options) => {
    const base = fakeProfile(options.headers?.Authorization);
    return { ...base, membership: { ...base.membership, companies } };
  };

const catalog = {
  categories: [
    {
      id: CARTERA,
      name: 'Cartera',
      subcategories: [
        { id: PAGOS, name: 'Confirmación de pago', description: 'Para pagos hechos fuera de la plataforma.', defaultPriorityId: MEDIUM },
        { id: OTRA, name: 'Paz y salvo', description: null, defaultPriorityId: null },
      ],
    },
  ],
  companies: [{ id: MAIN, name: 'Electrocréditos' }],
  recent: [] as string[],
};

const priorities = {
  items: [
    { id: MEDIUM, name: 'Media', sortOrder: 2, color: null, isActive: true, isDefault: true },
    { id: HIGH, name: 'Alta', sortOrder: 1, color: null, isActive: true, isDefault: false },
    { id: id(42), name: 'Vieja', sortOrder: 3, color: null, isActive: false, isDefault: false },
  ],
  page: 1,
  pageSize: 100,
  total: 3,
};

const field = (index: number, code: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
  id: id(100 + index),
  stepId: START,
  code,
  label,
  type,
  isRequired: false,
  isReadOnly: false,
    isImmutable: false,
  sortOrder: index,
  config: {},
  dataSource: null,
  ...extra,
});

const creationForm = {
  subcategoryId: PAGOS,
  workflowId: id(31),
  versionId: id(32),
  companyId: MAIN,
  defaultPriorityId: MEDIUM,
  starts: [{ stepId: START, name: 'Registrar pago', description: null, fields: [field(1, 'AMOUNT', 'Monto', 'CURRENCY', { isRequired: true, config: { currencyCode: 'COP' } }), field(2, 'TOTAL', 'Total', 'FORMULA')] }],
};

const created = { id: NEW_TICKET, number: '58', status: 'OPEN', currentStepId: id(33), openVisitId: id(34) };

function handlers(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/auth/me': profile([{ id: MAIN, name: 'Electrocréditos', isDefault: true }]),
    '/catalog/available': () => catalog,
    '/priorities': () => priorities,
    [`/subcategories/${PAGOS}/creation-form`]: () => creationForm,
    '/tickets': () => created,
    ...extra,
  };
}

async function chooseRequest() {
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Categoría/ }), await screen.findByRole('option', { name: 'Cartera' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /Subcategoría/ }), 'Confirmación de pago');
  await screen.findByRole('textbox', { name: /Asunto/ });
}

describe('NewTicketPage', () => {
  it('asks to choose the request first, and offers only the active priorities in their order', async () => {
    renderRoute('/tickets/new', { handlers: handlers() });

    expect(await screen.findByRole('heading', { level: 1, name: 'Nuevo ticket' })).toBeInTheDocument();
    expect(screen.getByText('Elige la categoría y la subcategoría para ver los datos que pide la solicitud.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Empresa' })).toBeNull();
    const group = await screen.findByRole('group', { name: 'Prioridad de la solicitud' });
    expect(within(group).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(['Alta', 'Media']);
  });

  it('picks a recently used request with one click', async () => {
    renderRoute('/tickets/new', { handlers: handlers({ '/catalog/available': () => ({ ...catalog, recent: [PAGOS, id(999)] }) }) });

    const shortcuts = await screen.findByRole('group', { name: 'Usadas hace poco' });
    // A subcategory the catalog no longer offers is not a shortcut.
    expect(within(shortcuts).getAllByRole('button')).toHaveLength(1);
    await userEvent.click(within(shortcuts).getByRole('button', { name: 'Cartera › Confirmación de pago' }));

    expect(screen.getByRole('combobox', { name: /Subcategoría/ })).toHaveValue(PAGOS);
    expect(await screen.findByRole('textbox', { name: /Asunto/ })).toBeInTheDocument();
    expect(within(shortcuts).getByRole('button', { name: 'Cartera › Confirmación de pago' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('creates the ticket with the subject, the start fields, the default priority and the description, and opens it', async () => {
    const { fake, router } = renderRoute('/tickets/new', { handlers: handlers() });

    await chooseRequest();
    expect(screen.getByRole('radio', { name: 'Media' })).toBeChecked();
    expect(screen.getAllByText('Para pagos hechos fuera de la plataforma.')).toHaveLength(2);
    // As in the help desk, the description starts with the subcategory's guide, for the person to fill in.
    expect(screen.getByRole('textbox', { name: 'Descripción' })).toHaveTextContent('Para pagos hechos fuera de la plataforma.');
    expect(screen.queryByRole('textbox', { name: 'Total' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));
    expect(screen.getByRole('textbox', { name: /Asunto/ })).toHaveAccessibleDescription('Escribe el asunto de la solicitud.');
    expect(screen.getByRole('textbox', { name: /Monto/ })).toHaveAccessibleDescription(/Este dato es obligatorio\./);
    expect(fake.callsTo('/tickets')).toHaveLength(0);

    await userEvent.type(screen.getByRole('textbox', { name: /Asunto/ }), 'Pago de cuota');
    await userEvent.type(screen.getByRole('textbox', { name: /Monto/ }), '850.000');
    typeInEditor(screen.getByRole('textbox', { name: 'Descripción' }), 'En la sede norte');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/tickets/${NEW_TICKET}`));
    expect(fake.callsTo('/tickets')[0]?.options).toMatchObject({
      method: 'POST',
      body: { subcategoryId: PAGOS, startStepId: START, companyId: MAIN, title: 'Pago de cuota', description: '<p>En la sede nortePara pagos hechos fuera de la plataforma.</p>', values: { AMOUNT: '850000' }, attachments: [] },
    });
    expect(fake.callsTo('/tickets')[0]?.options.body).not.toHaveProperty('priorityId');
    expect(fake.callsTo(`/subcategories/${PAGOS}/creation-form`)[0]?.path).toBe(`/subcategories/${PAGOS}/creation-form?companyId=${MAIN}`);
  });

  it('does not ask for a «fecha actual» date, says it fills itself, and sends it empty for the API to fill', async () => {
    const dated = { ...creationForm, starts: [{ ...creationForm.starts[0]!, fields: [field(3, 'PAID_ON', 'Fecha del pago', 'DATE', { isRequired: true, config: { defaultNow: true } })] }] };
    const { fake } = renderRoute('/tickets/new', { handlers: handlers({ [`/subcategories/${PAGOS}/creation-form`]: () => dated }) });

    await chooseRequest();
    expect(screen.getByLabelText(/Fecha del pago/)).toHaveAccessibleDescription('Si lo dejas vacío, queda la fecha de hoy.');
    await userEvent.type(screen.getByRole('textbox', { name: /Asunto/ }), 'Pago');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));

    await vi.waitFor(() => expect(fake.callsTo('/tickets')).toHaveLength(1));
    // Sent blank, which the API fills with the date of the day.
    expect((fake.callsTo('/tickets')[0]?.options.body as { values: Record<string, unknown> }).values.PAID_ON).toBeNull();
  });

  it('fills a field from the Excel row of the key typed in another one', async () => {
    const withLookup = {
      ...creationForm,
      starts: [
        {
          ...creationForm.starts[0]!,
          fields: [
            field(1, 'CEDULA', 'Cédula', 'TEXT'),
            field(2, 'NOMBRE', 'Nombre del cliente', 'TEXT', { dataSource: { kind: 'DATASET', datasetId: id(80), column: 'NOMBRE', lookupFieldCode: 'CEDULA' } }),
          ],
        },
      ],
    };
    const { fake } = renderRoute('/tickets/new', {
      handlers: handlers({
        [`/subcategories/${PAGOS}/creation-form`]: () => withLookup,
        [`/fields/${id(102)}/dataset-lookup`]: (_options, path) => ({ value: path.endsWith('key=1010') ? 'Ana Ruiz' : null }),
      }),
    });

    await chooseRequest();
    await userEvent.type(screen.getByRole('textbox', { name: 'Cédula' }), '1010');
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'Nombre del cliente' })).toHaveValue('Ana Ruiz'));
    expect(fake.callsTo(`/fields/${id(102)}/dataset-lookup`)).toHaveLength(1);
  });

  it('creates a ticket for someone else: their catalog and their companies, and the requester in the request', async () => {
    const OLGA = id(70);
    const OTHER_COMPANY = id(71);
    const desk = { permissions: [{ action: 'create_for_others', subject: 'Ticket', conditional: false }, { action: 'read', subject: 'Priority', conditional: false }] };
    const { fake, router } = renderRoute('/tickets/new', {
      handlers: handlers({
        '/auth/me/permissions': () => desk,
        '/members/directory': () => [{ userId: OLGA, firstName: 'Olga', lastName: 'Pérez' }],
        '/catalog/available': () => ({ ...catalog, companies: [{ id: OTHER_COMPANY, name: 'Finansueños' }] }),
        [`/subcategories/${PAGOS}/creation-form`]: () => ({ ...creationForm, companyId: OTHER_COMPANY }),
      }),
    });

    expect(await screen.findByText('Busca a la persona para quien es la solicitud.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Categoría/ })).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar a otra persona/ }), 'olga');
    await userEvent.click(await screen.findByRole('button', { name: 'Crear para Olga Pérez' }));
    expect(screen.getByText('Para Olga Pérez. Las categorías y el formulario son los suyos.')).toBeInTheDocument();

    await chooseRequest();
    await userEvent.type(screen.getByRole('textbox', { name: /Asunto/ }), 'Pago de Olga');
    await userEvent.type(screen.getByRole('textbox', { name: /Monto/ }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/tickets/${NEW_TICKET}`));
    expect(fake.callsTo('/tickets')[0]?.options.body).toMatchObject({ requesterId: OLGA, companyId: OTHER_COMPANY, title: 'Pago de Olga' });
    expect(fake.callsTo('/catalog/available').map((call) => call.path)).toContain(`/catalog/available?companyId=${OTHER_COMPANY}&requesterId=${OLGA}`);
    expect(fake.callsTo(`/subcategories/${PAGOS}/creation-form`).at(-1)?.path).toBe(`/subcategories/${PAGOS}/creation-form?companyId=${OTHER_COMPANY}&requesterId=${OLGA}`);
  });

  it('sends the priority the person picks, and the company they choose when they are in several', async () => {
    const { fake } = renderRoute('/tickets/new', {
      handlers: handlers({ '/auth/me': profile([{ id: MAIN, name: 'Electrocréditos', isDefault: false }, { id: BRANCH, name: 'Finansueños', isDefault: true }]), [`/subcategories/${PAGOS}/creation-form`]: () => ({ ...creationForm, companyId: BRANCH }) }),
    });

    expect(await screen.findByRole('combobox', { name: 'Empresa' })).toHaveValue(BRANCH);
    await vi.waitFor(() => expect(fake.callsTo('/catalog/available')[0]?.path).toBe(`/catalog/available?companyId=${BRANCH}`));
    await chooseRequest();
    await userEvent.click(screen.getByRole('radio', { name: 'Alta' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Asunto/ }), 'Pago');
    await userEvent.type(screen.getByRole('textbox', { name: /Monto/ }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));

    await vi.waitFor(() => expect(fake.callsTo('/tickets')[0]?.options.body).toMatchObject({ companyId: BRANCH, priorityId: HIGH }));
  });

  it('says why a request cannot be started', async () => {
    const refused = () => {
      throw new ApiError({ status: 422, code: 'INITIATOR_NOT_ALLOWED', message: 'x' });
    };
    renderRoute('/tickets/new', { handlers: handlers({ [`/subcategories/${PAGOS}/creation-form`]: refused }) });

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Categoría/ }), await screen.findByRole('option', { name: 'Cartera' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Subcategoría/ }), 'Confirmación de pago');

    expect(await screen.findByText('Tu cargo, sede o grupo no puede iniciar esta solicitud.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear y enviar' })).toBeNull();
  });

  it('asks who takes the first step when the API says it must be chosen', async () => {
    let calls = 0;
    const create = () => {
      calls += 1;
      if (calls === 1) throw new ApiError({ status: 422, code: 'ASSIGNEE_SELECTION_REQUIRED', message: 'x', details: { stepId: id(33), candidates: [{ userId: id(60), name: 'Luis Gómez' }] } });
      return created;
    };
    const { fake } = renderRoute('/tickets/new', { handlers: handlers({ '/tickets': create }) });

    await chooseRequest();
    await userEvent.type(screen.getByRole('textbox', { name: /Asunto/ }), 'Pago');
    await userEvent.type(screen.getByRole('textbox', { name: /Monto/ }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Quién recibe el siguiente paso/ }), 'Luis Gómez');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));

    await vi.waitFor(() => expect(fake.callsTo('/tickets')[1]?.options.body).toMatchObject({ assigneeId: id(60) }));
  });

  it('says where the ticket goes as the data is typed, and asks who takes the first step when it must be chosen', async () => {
    const preview = (options: { body?: unknown }) => {
      const amount = (options.body as { values?: Record<string, unknown> } | undefined)?.values?.['AMOUNT'];
      const big = typeof amount === 'string' && Number(amount) > 1000;
      return {
        outcome: 'STEP',
        via: [],
        step: { id: id(33), name: big ? 'Dirección' : 'Tesorería', type: 'TASK' },
        assignment: big ? 'CHOOSE' : 'PERSON',
        people: big ? [{ id: id(60), name: 'Luis Gómez' }, { id: id(61), name: 'Marta Ruiz' }] : [{ id: id(62), name: 'Ana Díaz' }],
        fields: [],
        resumeAt: null,
        blocked: null,
      };
    };
    const { fake } = renderRoute('/tickets/new', { handlers: handlers({ '/tickets/creation-preview': preview, '/tickets': () => created }) });

    await chooseRequest();
    const summary = await screen.findByRole('region', { name: 'Qué sigue' });
    await vi.waitFor(() => expect(summary).toHaveTextContent('Lo recibe Ana Díaz.'));
    expect(screen.queryByRole('combobox', { name: /Quién recibe el siguiente paso/ })).toBeNull();

    await userEvent.type(screen.getByRole('textbox', { name: /Asunto/ }), 'Pago');
    await userEvent.type(screen.getByRole('textbox', { name: /Monto/ }), '5000');
    await vi.waitFor(() => expect(summary).toHaveTextContent('Pasa a «Dirección».'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Quién recibe el siguiente paso/ }), 'Marta Ruiz');
    await userEvent.click(screen.getByRole('button', { name: 'Crear y enviar' }));

    await vi.waitFor(() => expect(fake.callsTo('/tickets')[0]?.options.body).toMatchObject({ assigneeId: id(61) }));
    expect(fake.callsTo('/tickets/creation-preview').at(-1)?.options.body).toMatchObject({ values: { AMOUNT: '5000' } });
  });

  it('tells a person without a company that they cannot create tickets', async () => {
    renderRoute('/tickets/new', { handlers: handlers({ '/auth/me': profile([]) }) });
    expect(await screen.findByText(/No perteneces a ninguna empresa/)).toBeInTheDocument();
  });
});
