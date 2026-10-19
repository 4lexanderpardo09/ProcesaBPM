import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { openDownload } from '@/shared/lib/open-download';
import { fakeProfile } from '@/test/fake-profile';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

vi.mock('@/shared/lib/open-download', () => ({ openDownload: vi.fn() }));

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
/** The signed-in person of the test session (`fakeProfile`). */
const ME = id(1);
const OTHER = id(50);
const TICKET = id(100);
const STEP = id(101);
const FILE = id(102);
const at = '2026-10-17T15:00:00.000Z';

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET,
  number: 'T-1042',
  title: 'Confirmación de pago de crédito',
  status: 'OPEN',
  companyId: id(103),
  creatorId: OTHER,
  subcategoryId: id(104),
  currentStepId: STEP,
  createdAt: at,
  closedAt: null,
  tags: [],
  creator: { id: OTHER, name: 'Luis Gómez' },
  subcategory: { id: id(104), name: 'Pagos', category: { id: id(108), name: 'Cartera' } },
  currentStep: { id: STEP, name: 'Revisión' },
  priority: null,
  sla: null,
  workflowId: id(105),
  workflowVersionId: id(106),
  registeredById: null,
  descriptionHtml: '<p>Adjunto el comprobante del pago del <strong>1 de octubre</strong>.</p>',
  priorityId: null,
  departmentId: null,
  siteId: null,
  currentLoop: 0,
  closedById: null,
  openVisit: { id: id(107), stepId: STEP, loop: 0, enteredAt: at, dueAt: '2099-01-01T15:00:00.000Z' },
  assignees: [{ userId: ME, name: 'Ana Pérez', type: 'PRIMARY', assignedAt: at }],
  awaitingDispatch: false,
  parallelTasks: [],
  openIncident: null,
  waitingUntil: null,
  values: { paymentType: 'capital', amount: '1250000.00', paidOn: '2026-10-01', notes: '' },
  totals: {},
  ...overrides,
});

const field = (index: number, code: string, label: string, type: string, config: Record<string, unknown> = {}) => ({
  id: id(200 + index),
  stepId: STEP,
  code,
  label,
  type,
  isRequired: false,
  isReadOnly: false,
  sortOrder: index,
  config,
  dataSource: null,
});

const form = {
  ticketId: TICKET,
  versionId: id(106),
  visitId: id(107),
  step: { id: STEP, name: 'Validación de cartera', type: 'TASK', description: null, closeRule: 'NOT_ALLOWED' },
  fields: [
    field(2, 'amount', 'Monto', 'CURRENCY', { currencyCode: 'COP' }),
    field(1, 'paymentType', 'Tipo de pago', 'SELECT', { options: [{ value: 'capital', label: 'Abono a capital' }] }),
    field(3, 'paidOn', 'Fecha del pago', 'DATE'),
    field(4, 'notes', 'Observaciones', 'TEXTAREA'),
  ],
  editableFieldCodes: [],
  decisions: [],
};

const event = (index: number, type: string, actorId: string | null, commentHtml: string | null = null) => ({
  id: id(300 + index),
  type,
  stepId: STEP,
  transitionId: null,
  loop: 0,
  actorId,
  assigneeId: null,
  commentHtml,
  data: {},
  createdAt: at,
});

const timeline = [event(1, 'CREATED', ME), event(2, 'ASSIGNED', null), event(3, 'COMMENTED', OTHER, '<p>Estoy cruzando el comprobante.</p>')];

const documents = [
  {
    id: id(400),
    role: 'ATTACHMENT',
    eventId: null,
    stepId: null,
    fieldCode: null,
    version: 1,
    isCurrent: true,
    createdAt: at,
    file: { id: FILE, name: 'comprobante-pago.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 48_000, status: 'CONFIRMED', createdAt: at, confirmedAt: at },
  },
  { id: id(401), role: 'ATTACHMENT', eventId: null, stepId: null, fieldCode: null, version: 1, isCurrent: false, createdAt: at, file: { id: id(103), name: 'version-vieja.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 100, status: 'CONFIRMED', createdAt: at, confirmedAt: at } },
];

const base = `/tickets/${TICKET}`;

/** The person works in Bogotá, so the times below read the same on any machine. */
const profileInBogota: FakeHandler = (options) => {
  const profile = fakeProfile(options.headers?.Authorization);
  return { ...profile, user: { ...profile.user, timeZone: 'America/Bogota' } };
};

function ticketHandlers(overrides: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/auth/me': profileInBogota,
    [base]: () => detail(),
    [`${base}/form`]: () => form,
    [`${base}/timeline`]: () => timeline,
    [`${base}/documents`]: () => documents,
    ...overrides,
  };
}

const forbidden = () => {
  throw new ApiError({ status: 403, code: 'PERMISSION_DENIED', message: 'Forbidden' });
};

describe('TicketDetailPage', () => {
  beforeEach(() => {
    vi.mocked(openDownload).mockClear();
  });

  it('shows the ticket: header, facts, description, values, activity and attachments', async () => {
    renderRoute(base, { handlers: ticketHandlers() });

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmación de pago de crédito' })).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Ruta de navegación' });
    expect(within(breadcrumb).getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/tickets');
    expect(within(breadcrumb).getByText('T-1042')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Abierto')).toBeInTheDocument();

    const facts = screen.getByLabelText('Resumen del ticket');
    const factPairs = within(facts)
      .getAllByRole('term')
      .map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`);
    expect(factPairs).toEqual(['Creado: 17 de octubre de 2026 a las 10:00 a. m.', expect.stringMatching(/^Paso actual: (…|Validación de cartera)$/), 'Responsables: Tú', 'Vence: 1 de enero de 2099 a las 10:00 a. m.']);
    expect(await within(facts).findByText('Validación de cartera')).toBeInTheDocument();

    expect(screen.getByText(/Adjunto el comprobante/)).toBeInTheDocument();
    expect(screen.getByText('1 de octubre').tagName).toBe('STRONG');

    const values = (await screen.findByText('Tipo de pago')).closest('dl')!;
    expect(within(values).getAllByRole('term').map((term) => term.textContent)).toEqual(['Tipo de pago', 'Monto', 'Fecha del pago']);
    expect(within(values).getAllByRole('definition').map((value) => value.textContent?.replace(/\s/g, ' '))).toEqual(['Abono a capital', '$ 1.250.000', '1 de oct de 2026']);

    expect(await screen.findByText('creó el ticket', { exact: false })).toHaveTextContent('Tú creó el ticket');
    expect(screen.getByText('asignó el ticket', { exact: false })).toHaveTextContent('Sistema asignó el ticket');
    expect(screen.getByText('comentó', { exact: false })).toHaveTextContent('Otra persona comentó');
    expect(screen.getByText('Estoy cruzando el comprobante.')).toBeInTheDocument();

    expect(await screen.findByText('comprobante-pago.pdf')).toBeInTheDocument();
    expect(screen.queryByText('version-vieja.pdf')).toBeNull();
  });

  it('adds a comment as escaped HTML and shows it in the activity', async () => {
    const comments: string[] = [];
    const { fake } = renderRoute(base, {
      handlers: ticketHandlers({
        [`${base}/comments`]: (options) => {
          comments.push((options.body as { comment: string }).comment);
          return { eventId: id(399) };
        },
        [`${base}/timeline`]: () => [...timeline, ...comments.map((comment, index) => event(10 + index, 'COMMENTED', ME, comment))],
      }),
    });

    const box = await screen.findByRole('textbox', { name: 'Agregar un comentario' });
    await userEvent.type(box, 'Revisado <ok>{enter}{enter}Gracias');
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    expect(await screen.findByText('Revisado <ok>')).toBeInTheDocument();
    expect(comments).toEqual(['<p>Revisado &lt;ok&gt;</p><p>Gracias</p>']);
    expect(fake.callsTo(`${base}/comments`)[0]?.options.method).toBe('POST');
    expect(box).toHaveValue('');
  });

  it('asks for the comment instead of sending an empty one', async () => {
    const { fake } = renderRoute(base, { handlers: ticketHandlers() });

    await userEvent.click(await screen.findByRole('button', { name: 'Comentar' }));

    expect(screen.getByRole('textbox', { name: 'Agregar un comentario' })).toHaveAccessibleDescription('Escribe un comentario.');
    expect(fake.callsTo(`${base}/comments`)).toHaveLength(0);
  });

  it('says so when the person may not comment', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [`${base}/comments`]: forbidden }) });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Agregar un comentario' }), 'Hola');
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    expect(await screen.findByText('No tienes permiso para comentar en este ticket.')).toBeInTheDocument();
  });

  it('downloads an attachment through a link asked for on click', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [`${base}/files/${FILE}/download-url`]: () => ({ url: 'https://files.example/comprobante?sig=1', expiresAt: at }) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Descargar comprobante-pago.pdf' }));

    await vi.waitFor(() => expect(openDownload).toHaveBeenCalledWith('https://files.example/comprobante?sig=1'));
  });

  it('says when the download link could not be had', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [`${base}/files/${FILE}/download-url`]: forbidden }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Descargar comprobante-pago.pdf' }));

    expect(await screen.findByText('No se pudo descargar el archivo. Intenta de nuevo.')).toBeInTheDocument();
    expect(openDownload).not.toHaveBeenCalled();
  });

  it('marks an overdue ticket and explains an open incident', async () => {
    const incident = { id: id(500), assignedToId: ME, createdById: OTHER, openedAt: at, descriptionHtml: '<p>Falta el extracto.</p>' };
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ status: 'PAUSED', openIncident: incident }) }) });

    expect(await screen.findByText('Pausado por una novedad')).toBeInTheDocument();
    expect(screen.getByText('Falta el extracto.')).toBeInTheDocument();
    expect(screen.getByText('La novedad está a tu cargo.')).toBeInTheDocument();
    expect(screen.queryByText('Vencido')).toBeNull();
  });

  it('marks an open ticket past its due date', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ openVisit: { id: id(107), stepId: STEP, loop: 0, enteredAt: at, dueAt: '2026-01-01T15:00:00.000Z' } }) }) });
    expect(await screen.findByText('Vencido')).toBeInTheDocument();
  });

  it('shows when a closed ticket was closed instead of its step and holders', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ status: 'CLOSED', closedAt: '2026-10-18T15:00:00.000Z', openVisit: null, assignees: [] }) }) });

    const facts = await screen.findByLabelText('Resumen del ticket');
    expect(within(facts).getAllByRole('term').map((term) => term.textContent)).toEqual(['Creado', 'Cerrado']);
    expect(within(facts).getByText('18 de octubre de 2026 a las 10:00 a. m.')).toBeInTheDocument();
  });

  it('says the ticket is not there when the API does not show it', async () => {
    const notFound = () => {
      throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Not found' });
    };
    renderRoute(base, { handlers: ticketHandlers({ [base]: notFound }) });

    expect(await screen.findByRole('heading', { level: 1, name: 'No encontramos este ticket' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la bandeja' })).toHaveAttribute('href', '/tickets');
  });
});
