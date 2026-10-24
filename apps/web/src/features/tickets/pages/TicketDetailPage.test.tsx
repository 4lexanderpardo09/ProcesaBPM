import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { openDownload } from '@/shared/lib/open-download';
import { fakeProfile } from '@/test/fake-profile';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';
import { selectAllInEditor, typeInEditor } from '@/test/rich-text-editor';

vi.mock('@/shared/lib/open-download', () => ({ openDownload: vi.fn() }));

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
/** The signed-in person of the test session (`fakeProfile`). */
const ME = id(1);
const OTHER = id(50);
const TICKET = id(100);
const STEP = id(101);
const FILE = id(102);
const at = '2026-10-17T15:00:00.000Z';

const noActions = { advance: false, take: false, reassign: false, close: false, openIncident: false, resolveIncident: false, reopen: false, signParallelTask: false, comment: true, reportError: false, edit: false };

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
  company: { id: id(103), name: 'Electrocréditos' },
  registeredBy: null,
  closedBy: null,
  department: null,
  site: null,
  valueNames: { users: {}, sites: {}, companies: {}, departments: {}, positions: {} },
  actions: noActions,
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
  actor: actorId === null ? null : { id: actorId, name: actorId === ME ? 'Ana Pérez' : 'Luis Gómez' },
  assignee: null,
  step: { id: STEP, name: 'Revisión' },
  transition: null,
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

const flow = {
  ticketId: TICKET,
  versionId: id(106),
  status: 'OPEN',
  currentStepId: STEP,
  steps: [
    { id: id(600), type: 'START', name: 'Inicio', position: { x: 0, y: 0 }, passCount: 1 },
    { id: STEP, type: 'TASK', name: 'Revisión', position: { x: 220, y: 0 }, passCount: 1 },
    { id: id(601), type: 'END', name: 'Fin', position: { x: 440, y: 0 }, passCount: 0 },
  ],
  transitions: [
    { id: id(610), fromStepId: id(600), toStepId: STEP, type: 'DEFAULT', label: '', points: null, takenCount: 1 },
    { id: id(611), fromStepId: STEP, toStepId: id(601), type: 'DECISION', label: 'Aprobar', points: null, takenCount: 0 },
  ],
};

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
    [`${base}/flow`]: () => flow,
    [`${base}/step-files`]: () => [],
    [`${base}/document-jobs`]: () => ({ canRegenerate: false, documents: [] }),
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
    expect(factPairs).toEqual([
      'Solicitante: Luis Gómez',
      'Categoría: Cartera › Pagos',
      'Empresa: Electrocréditos',
      'Creado: 17 de oct de 2026',
      'Paso actual: Revisión',
      'Responsables: Ana Pérez',
      'Vence: 1 de enero de 2099 a las 10:00 a. m.',
    ]);

    expect(screen.getByText(/Adjunto el comprobante/)).toBeInTheDocument();
    expect(screen.getByText('1 de octubre').tagName).toBe('STRONG');

    const values = (await screen.findByText('Tipo de pago')).closest('dl')!;
    expect(within(values).getAllByRole('term').map((term) => term.textContent)).toEqual(['Tipo de pago', 'Monto', 'Fecha del pago']);
    expect(within(values).getAllByRole('definition').map((value) => value.textContent?.replace(/\s/g, ' '))).toEqual(['Abono a capital', '$ 1.250.000', '1 de oct de 2026']);

    expect(await screen.findByText('creó el ticket', { exact: false })).toHaveTextContent(/^Ana Pérez creó el ticket · Revisión · /);
    expect(screen.getByText('asignó el ticket', { exact: false })).toHaveTextContent(/^Sistema asignó el ticket · Revisión/);
    expect(screen.getByText('comentó', { exact: false })).toHaveTextContent(/^Luis Gómez comentó/);
    expect(screen.getByText('Estoy cruzando el comprobante.')).toBeInTheDocument();

    expect(await screen.findByText('comprobante-pago.pdf')).toBeInTheDocument();
    expect(screen.queryByText('version-vieja.pdf')).toBeNull();
  }, 15_000);

  it('opens the rows of a table: cells formatted like fields, the totals and its files to download', async () => {
    const items = field(5, 'items', 'Gastos', 'TABLE', {
      columns: [
        { code: 'ITEM', label: 'Gasto', type: 'SELECT', options: [{ value: 'taxi', label: 'Taxi' }] },
        { code: 'VALUE', label: 'Valor', type: 'CURRENCY', showTotal: true },
        { code: 'ON', label: 'Fecha', type: 'DATE' },
        { code: 'PROOF', label: 'Soporte', type: 'FILE' },
      ],
    });
    renderRoute(base, {
      handlers: ticketHandlers({
        [base]: () => detail({ values: { items: [{ ITEM: 'taxi', VALUE: '25000.00', ON: '2026-10-01', PROOF: [FILE] }, { ITEM: 'otro', VALUE: '5000.50' }] }, totals: { items: { VALUE: '30000.50' } } }),
        [`${base}/form`]: () => ({ ...form, fields: [items] }),
        [`${base}/files/${FILE}/download-url`]: () => ({ url: 'https://files.example/comprobante?sig=1', expiresAt: at }),
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Ver las filas de «Gastos»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gastos' });
    const rows = within(dialog).getAllByRole('row').map((row) => row.textContent);
    expect(rows[1]).toBe('Taxi25.000,001 de oct de 2026comprobante-pago.pdf');
    expect(rows[2]).toBe('otro5.000,50——');
    expect(rows[3]).toBe('Total30.000,50');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descargar comprobante-pago.pdf' }));
    await vi.waitFor(() => expect(openDownload).toHaveBeenCalledWith('https://files.example/comprobante?sig=1'));
  });

  it('says what an edit and a submitted form changed', async () => {
    const priority = { id: id(700), name: 'Alta', color: '#be123c', sortOrder: 1, isActive: true, isDefault: false, createdAt: at };
    const edited = {
      ...event(4, 'FIELDS_UPDATED', ME),
      data: {
        source: 'EDIT',
        changes: [
          { code: 'title', before: 'Pago', after: 'Confirmación de pago de crédito' },
          { code: 'descriptionHtml', before: '', after: '<p>Adjunto</p>' },
          { code: 'priorityId', before: null, after: priority.id },
        ],
      },
    };
    const submitted = { ...event(5, 'FIELDS_UPDATED', OTHER), data: { changes: [{ code: 'paidOn', before: null, after: '2026-10-01' }] } };
    renderRoute(base, {
      handlers: ticketHandlers({
        [`${base}/timeline`]: () => [...timeline, edited, submitted],
        '/priorities': () => ({ items: [priority], page: 1, pageSize: 100, total: 1 }),
      }),
    });

    expect(await screen.findByText('Asunto: Pago → Confirmación de pago de crédito')).toBeInTheDocument();
    expect(screen.getByText('Cambió la descripción')).toBeInTheDocument();
    expect(await screen.findByText('Prioridad: (vacío) → Alta')).toBeInTheDocument();
    expect(await screen.findByText('Fecha del pago: (vacío) → 1 de oct de 2026')).toBeInTheDocument();
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
    typeInEditor(box, 'Revisado <ok>\nGracias');
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    expect(await screen.findByText('Revisado <ok>')).toBeInTheDocument();
    expect(comments).toEqual(['<p>Revisado &lt;ok&gt;</p><p>Gracias</p>']);
    expect(fake.callsTo(`${base}/comments`)[0]?.options.method).toBe('POST');
    await vi.waitFor(() => expect(box).toHaveTextContent(''));
  });

  it('formats a comment with the toolbar: bold and a list, sent as HTML', async () => {
    const { fake } = renderRoute(base, { handlers: ticketHandlers({ [`${base}/comments`]: () => ({ eventId: id(399) }) }) });

    const box = await screen.findByRole('textbox', { name: 'Agregar un comentario' });
    typeInEditor(box, 'Revisado');
    selectAllInEditor(box);
    await userEvent.click(screen.getByRole('button', { name: 'Negrita' }));
    expect(screen.getByRole('button', { name: 'Negrita' })).toHaveAttribute('aria-pressed', 'true');
    typeInEditor(box, '\n', { at: 'end' });
    await userEvent.click(screen.getByRole('button', { name: 'Negrita' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));
    typeInEditor(box, 'la cédula\nel RUT');
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    await vi.waitFor(() => expect(fake.callsTo(`${base}/comments`)[0]?.options.body).toEqual({ comment: '<p><strong>Revisado</strong></p><ul><li><p>la cédula</p></li><li><p>el RUT</p></li></ul>', attachments: [] }));
  });

  it('sends the files chosen with a comment and shows them under it in the activity', async () => {
    const FILE_ID = id(910);
    const slot = { fileId: FILE_ID, url: 'http://storage.test/bucket/key?sig=2', method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '4' }, expiresAt: at };
    const stored = { id: FILE_ID, name: 'extracto.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 4, status: 'CONFIRMED', createdAt: at, confirmedAt: at };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
    const linked = { id: id(411), role: 'ATTACHMENT', eventId: id(310), stepId: STEP, fieldCode: null, version: 1, isCurrent: true, createdAt: at, file: stored };
    let commented = false;
    const { fake } = renderRoute(base, {
      handlers: ticketHandlers({
        '/files/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }),
        [`/files/${FILE_ID}/confirm`]: () => stored,
        [`${base}/comments`]: () => {
          commented = true;
          return { eventId: id(310) };
        },
        [`${base}/timeline`]: () => (commented ? [...timeline, event(10, 'COMMENTED', ME, '<p>Va el extracto</p>')] : timeline),
        [`${base}/documents`]: () => (commented ? [...documents, linked] : documents),
      }),
    });

    typeInEditor(await screen.findByRole('textbox', { name: 'Agregar un comentario' }), 'Va el extracto');
    await userEvent.upload(screen.getByLabelText(/^Adjuntar archivos \(hasta/), new File(['%PDF'], 'extracto.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('list', { name: 'Archivos de «Adjuntar archivos»' })).toHaveTextContent('extracto.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    await vi.waitFor(() => expect(fake.callsTo(`${base}/comments`)[0]?.options.body).toEqual({ comment: '<p>Va el extracto</p>', attachments: [FILE_ID] }));
    const files = await screen.findByRole('list', { name: 'Archivos adjuntos' });
    expect(within(files).getByRole('button', { name: 'Descargar extracto.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Archivos de «Adjuntar archivos»' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('asks for the comment instead of sending an empty one', async () => {
    const { fake } = renderRoute(base, { handlers: ticketHandlers() });

    await userEvent.click(await screen.findByRole('button', { name: 'Comentar' }));

    expect(screen.getByRole('textbox', { name: 'Agregar un comentario' })).toHaveAccessibleDescription(/Escribe un comentario\./);
    expect(fake.callsTo(`${base}/comments`)).toHaveLength(0);
  });

  it('inserts a text template into the comment where the cursor is, with its formatting', async () => {
    const { fake } = renderRoute(base, {
      handlers: ticketHandlers({
        '/text-templates': () => [{ id: id(398), title: 'Solicitud recibida', bodyHtml: '<p>Recibimos tu solicitud.</p><p>Te escribimos pronto.</p>', isOwner: false, ownerId: id(397), ownerName: 'Olga Pérez', updatedAt: at }],
      }),
    });

    const box = await screen.findByRole('textbox', { name: 'Agregar un comentario' });
    typeInEditor(box, 'Hola, Luis:\n');
    const template = await screen.findByRole('combobox', { name: 'Insertar plantilla' });
    await userEvent.selectOptions(template, 'Solicitud recibida');

    expect(Array.from(box.querySelectorAll('p'), (paragraph) => paragraph.textContent)).toEqual(['Hola, Luis:', 'Recibimos tu solicitud.', 'Te escribimos pronto.']);
    expect(template).toHaveValue('');
    expect(fake.callsTo(`${base}/comments`)).toHaveLength(0);
  });

  it('says so when the person may not comment', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [`${base}/comments`]: forbidden }) });

    typeInEditor(await screen.findByRole('textbox', { name: 'Agregar un comentario' }), 'Hola');
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    expect(await screen.findByText('No tienes permiso para comentar en este ticket.')).toBeInTheDocument();
  });

  it('downloads an attachment through a link asked for on click', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [`${base}/files/${FILE}/download-url`]: () => ({ url: 'https://files.example/comprobante?sig=1', expiresAt: at }) }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Descargar comprobante-pago.pdf' }));

    await vi.waitFor(() => expect(openDownload).toHaveBeenCalledWith('https://files.example/comprobante?sig=1'));
  });

  it('lists the support files of the step and downloads one', async () => {
    const guide = { id: id(110), name: 'guia-cartera.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 2048, status: 'CONFIRMED', createdAt: at, confirmedAt: at };
    renderRoute(base, {
      handlers: ticketHandlers({
        [`${base}/step-files`]: () => [{ label: 'Guía de cartera', file: guide }],
        [`${base}/files/${guide.id}/download-url`]: () => ({ url: 'https://files.example/guia?sig=1', expiresAt: at }),
      }),
    });

    const card = (await screen.findByRole('heading', { name: 'Archivos de apoyo del paso' })).closest('section')!;
    expect(within(card).getByText(/^guia-cartera\.pdf · /)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Descargar Guía de cartera' }));
    await vi.waitFor(() => expect(openDownload).toHaveBeenCalledWith('https://files.example/guia?sig=1'));
  });

  it('shows who signed the parallel step and who is still missing', async () => {
    const parallelTasks = [
      { id: id(120), userId: ME, name: 'Ana Pérez', status: 'SIGNED', completedAt: at },
      { id: id(121), userId: OTHER, name: 'Luis Gómez', status: 'PENDING', completedAt: null },
    ];
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ parallelTasks }) }) });

    const card = (await screen.findByRole('heading', { name: 'Firmas del paso' })).closest('section')!;
    expect(within(card).getByText('1 de 2 firmaron.')).toBeInTheDocument();
    expect(within(card).getByText('Firmó')).toBeInTheDocument();
    expect(within(card).getByText('Pendiente')).toBeInTheDocument();
  });

  it('says which document failed and draws it again for whoever may edit the ticket', async () => {
    const DOCUMENT = id(130);
    let state: string | null = 'FAILED';
    const { fake } = renderRoute(base, {
      handlers: ticketHandlers({
        [`${base}/document-jobs`]: (options) => {
          if (options.method === 'POST') state = 'GENERATING';
          return { canRegenerate: true, documents: [{ workflowDocumentId: DOCUMENT, name: 'Orden de pago', state, requestedAt: at }] };
        },
      }),
    });

    expect(await screen.findByText('No se pudo generar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Volver a generar «Orden de pago»' }));

    expect(await screen.findByText('Generando…')).toBeInTheDocument();
    expect(fake.calls.find((call) => call.path === `${base}/document-jobs` && call.options.method === 'POST')?.options.body).toEqual({ workflowDocumentId: DOCUMENT });
    expect(screen.queryByRole('button', { name: 'Volver a generar «Orden de pago»' })).not.toBeInTheDocument();
  });

  it('offers no document section to someone who cannot draw them again when nothing is pending', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [`${base}/document-jobs`]: () => ({ canRegenerate: false, documents: [{ workflowDocumentId: id(130), name: 'Orden de pago', state: null, requestedAt: null }] }) }) });

    expect(await screen.findByText('comprobante-pago.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Documentos del flujo')).not.toBeInTheDocument();
  });

  it('downloads every PDF and image of the ticket in one PDF, and says when they weigh too much', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:combined');
    URL.revokeObjectURL = vi.fn();
    const second = { ...documents[0]!, id: id(402), file: { ...documents[0]!.file, id: id(104), name: 'orden.pdf' } };
    let tooLarge = false;
    const { fake } = renderRoute(base, {
      handlers: ticketHandlers({
        [`${base}/documents`]: () => [...documents, second],
        [`${base}/documents/combined`]: () => {
          if (tooLarge) throw new ApiError({ status: 422, code: 'DOCUMENTS_TOO_LARGE', message: 'Too large' });
          return new Blob(['%PDF-1.7'], { type: 'application/pdf' });
        },
      }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Todo en un PDF' }));
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fake.callsTo(`${base}/documents/combined`)[0]?.options.responseType).toBe('blob');

    tooLarge = true;
    await userEvent.click(screen.getByRole('button', { name: 'Todo en un PDF' }));
    expect(await screen.findByText('Los archivos pesan demasiado para unirlos: descárgalos uno por uno.')).toBeInTheDocument();
  });

  it('offers no combined PDF when there is only one file to put in it', async () => {
    renderRoute(base, { handlers: ticketHandlers() });

    expect(await screen.findByText('comprobante-pago.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Todo en un PDF' })).toBeNull();
  });

  it('says when the download link could not be had', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [`${base}/files/${FILE}/download-url`]: forbidden }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Descargar comprobante-pago.pdf' }));

    expect(await screen.findByText('No se pudo descargar el archivo. Intenta de nuevo.')).toBeInTheDocument();
    expect(openDownload).not.toHaveBeenCalled();
  });

  it('draws the progress through the workflow, with the steps and their state for screen readers', async () => {
    renderRoute(base, { handlers: ticketHandlers() });

    const steps = await screen.findByRole('list', { name: 'Pasos del flujo y su estado' });
    expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Inicio Inicio: Completado', 'Paso Revisión: En curso', 'Fin Fin: Pendiente']);
    expect(screen.getByRole('list', { name: 'Convenciones del diagrama' })).toHaveTextContent('RecorridoPaso actualPendiente');
  });

  it('shows the SLA left and the priority', async () => {
    const dueAt = new Date(Date.now() + (2 * 24 + 3) * 3_600_000 + 60_000).toISOString();
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ sla: { dueAt, overdue: false, paused: false }, priority: { id: id(700), name: 'Alta', color: null } }) }) });

    expect(await screen.findByText('SLA 2 d 3 h')).toBeInTheDocument();
    expect(screen.getByText('Prioridad Alta')).toBeInTheDocument();
  });

  it('marks an overdue ticket and explains an open incident', async () => {
    const incident = {
      id: id(500),
      assignedToId: ME,
      createdById: OTHER,
      assignedTo: { id: ME, name: 'Ana Pérez' },
      createdBy: { id: OTHER, name: 'Luis Gómez' },
      openedAt: at,
      descriptionHtml: '<p>Falta el extracto.</p>',
    };
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ status: 'PAUSED', openIncident: incident }) }) });

    expect(await screen.findByText('Pausado por una novedad')).toBeInTheDocument();
    expect(screen.getByText('Falta el extracto.')).toBeInTheDocument();
    expect(screen.getByText('La novedad está a tu cargo.')).toBeInTheDocument();
    expect(screen.queryByText('SLA vencido')).toBeNull();
  });

  it('adds one of my tags to the ticket and removes another, without reading the whole ticket again', async () => {
    const urgent = { id: id(390), name: 'Urgente', color: '#be123c' };
    const vip = { id: id(391), name: 'Cliente VIP', color: '#6d28d9' };
    const { fake } = renderRoute(base, {
      handlers: ticketHandlers({
        [base]: () => detail({ tags: [urgent] }),
        '/tags': () => [urgent, vip],
        [`${base}/tags`]: () => undefined,
        [`${base}/tags/${urgent.id}`]: () => undefined,
      }),
    });

    const tags = await screen.findByRole('list', { name: 'Mis etiquetas' });
    expect(within(tags).getByText('Urgente')).toBeInTheDocument();
    await userEvent.click(within(tags).getByRole('button', { name: 'Agregar' }));
    const picker = await screen.findByRole('dialog', { name: 'Agregar etiqueta' });
    expect(within(picker).queryByRole('button', { name: 'Urgente' })).not.toBeInTheDocument();
    await userEvent.click(within(picker).getByRole('button', { name: 'Cliente VIP' }));

    await vi.waitFor(() => expect(fake.callsTo(`${base}/tags`)[0]?.options).toMatchObject({ method: 'POST', body: { tagId: vip.id } }));
    expect(await within(tags).findByText('Cliente VIP')).toBeInTheDocument();
    await userEvent.click(within(tags).getByRole('button', { name: 'Quitar la etiqueta Urgente' }));

    await vi.waitFor(() => expect(within(tags).queryByText('Urgente')).not.toBeInTheDocument());
    expect(fake.callsTo(`${base}/tags/${urgent.id}`)[0]?.options.method).toBe('DELETE');
    expect(fake.callsTo(base)).toHaveLength(1);
  });

  it('sends to the profile to create tags when there is none left to add', async () => {
    const urgent = { id: id(390), name: 'Urgente', color: '#be123c' };
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ tags: [urgent] }), '/tags': () => [urgent] }) });

    await userEvent.click(within(await screen.findByRole('list', { name: 'Mis etiquetas' })).getByRole('button', { name: 'Agregar' }));
    const picker = await screen.findByRole('dialog', { name: 'Agregar etiqueta' });

    expect(await within(picker).findByText(/Este ticket ya tiene todas tus etiquetas/)).toBeInTheDocument();
    expect(within(picker).getByRole('link', { name: 'Administrar mis etiquetas' })).toHaveAttribute('href', '/profile?tab=tags');
  });

  it('marks an open ticket past its due date', async () => {
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail({ sla: { dueAt: '2026-01-01T15:00:00.000Z', overdue: true, paused: false } }) }) });
    expect(await screen.findByText('SLA vencido')).toBeInTheDocument();
  });

  it('shows when a closed ticket was closed instead of its step and holders', async () => {
    const closed = { status: 'CLOSED', closedAt: '2026-10-18T15:00:00.000Z', closedBy: { id: OTHER, name: 'Luis Gómez' }, openVisit: null, assignees: [] };
    renderRoute(base, { handlers: ticketHandlers({ [base]: () => detail(closed) }) });

    const facts = await screen.findByLabelText('Resumen del ticket');
    expect(within(facts).getAllByRole('term').map((term) => term.textContent)).toEqual(['Solicitante', 'Categoría', 'Empresa', 'Creado', 'Cerrado']);
    expect(within(facts).getByText('18 de octubre de 2026 a las 10:00 a. m. por Luis Gómez')).toBeInTheDocument();
  });

  it('says the ticket is not there when the API does not show it', async () => {
    const notFound = () => {
      throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Not found' });
    };
    renderRoute(base, { handlers: ticketHandlers({ [base]: notFound }) });

    expect(await screen.findByRole('heading', { level: 1, name: 'No encontramos este ticket' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la bandeja' })).toHaveAttribute('href', '/tickets');
  });

  describe('actions', () => {
    const VISIT = id(107);
    const allowed = (...names: (keyof typeof noActions)[]) => ({ ...noActions, ...Object.fromEntries(names.map((name) => [name, true])) });
    const withActions = (actions: typeof noActions, extra: Record<string, FakeHandler> = {}) => ticketHandlers({ [base]: () => detail({ actions }), ...extra });
    const mutation = { id: TICKET, number: 'T-1042', status: 'OPEN', currentStepId: STEP, openVisitId: VISIT };
    const candidates = () => [
      { id: OTHER, name: 'Luis Gómez' },
      { id: id(51), name: 'Marta Ruiz' },
    ];

    it('offers only what the API allows, and no comment box to someone who may not comment', async () => {
      renderRoute(base, { handlers: withActions({ ...allowed('reassign', 'close'), comment: false }) });

      const group = await screen.findByRole('group', { name: 'Acciones del ticket' });
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Reasignar', 'Cerrar ticket']);
      expect(screen.queryByRole('textbox', { name: 'Agregar un comentario' })).toBeNull();
    });

    it('shows no actions at all when there are none', async () => {
      renderRoute(base, { handlers: ticketHandlers() });
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('group', { name: 'Acciones del ticket' })).toBeNull();
    });

    it('takes the ticket on its open visit and reads it again', async () => {
      const { fake } = renderRoute(base, { handlers: withActions(allowed('take'), { [`${base}/take`]: () => mutation }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Tomar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/take`)[0]?.options.body).toEqual({ visitId: VISIT }));
      await vi.waitFor(() => expect(fake.callsTo(base).length).toBeGreaterThan(1));
    });

    it('reassigns to someone the step allows, with an optional note', async () => {
      const { fake } = renderRoute(base, { handlers: withActions(allowed('reassign'), { [`${base}/candidates`]: candidates, [`${base}/reassign`]: () => mutation }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Reasignar' }));
      const dialog = screen.getByRole('dialog', { name: 'Reasignar ticket' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reasignar' }));
      expect(within(dialog).getByRole('combobox', { name: /Nuevo responsable/ })).toHaveAccessibleDescription('Elige a quién reasignar el ticket.');

      await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /Nuevo responsable/ }), await within(dialog).findByRole('option', { name: 'Marta Ruiz' }));
      typeInEditor(within(dialog).getByRole('textbox', { name: 'Comentario (opcional)' }), 'Va para cartera');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reasignar' }));

      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.callsTo(`${base}/candidates`)[0]?.path).toBe(`${base}/candidates?for=reassign`);
      expect(fake.callsTo(`${base}/reassign`)[0]?.options.body).toEqual({ visitId: VISIT, toUserId: id(51), comment: '<p>Va para cartera</p>' });
    });

    it('opens an incident for someone, describing it', async () => {
      const { fake } = renderRoute(base, { handlers: withActions(allowed('openIncident'), { [`${base}/candidates`]: candidates, [`${base}/incidents`]: () => ({ ...mutation, status: 'PAUSED', incidentId: id(500) }) }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Abrir novedad' }));
      const dialog = screen.getByRole('dialog', { name: 'Abrir novedad' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Abrir novedad' }));
      expect(within(dialog).getByRole('textbox', { name: /Qué pasa/ })).toHaveAccessibleDescription('Describe la novedad.');
      expect(fake.callsTo(`${base}/incidents`)).toHaveLength(0);

      await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /A cargo de/ }), await within(dialog).findByRole('option', { name: 'Luis Gómez' }));
      typeInEditor(within(dialog).getByRole('textbox', { name: /Qué pasa/ }), 'Falta el extracto');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Abrir novedad' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/incidents`)[0]?.options.body).toEqual({ visitId: VISIT, assignedToId: OTHER, description: '<p>Falta el extracto</p>' }));
      expect(fake.callsTo(`${base}/candidates`)[0]?.path).toBe(`${base}/candidates?for=incident`);
    });

    it('closes the ticket with closing documents uploaded in the dialog', async () => {
      const FILE_ID = id(920);
      const slot = { fileId: FILE_ID, url: 'http://storage.test/bucket/key?sig=3', method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '4' }, expiresAt: at };
      const stored = { id: FILE_ID, name: 'paz-y-salvo.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 4, status: 'CONFIRMED', createdAt: at, confirmedAt: at };
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
      const { fake } = renderRoute(base, {
        handlers: withActions(allowed('close'), { '/files/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }), [`/files/${FILE_ID}/confirm`]: () => stored, [`${base}/close`]: () => mutation }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Cerrar ticket' }));
      const dialog = screen.getByRole('dialog', { name: 'Cerrar ticket' });
      await userEvent.upload(within(dialog).getByLabelText(/^Adjuntar archivos \(hasta/), new File(['%PDF'], 'paz-y-salvo.pdf', { type: 'application/pdf' }));
      expect(await within(dialog).findByRole('list', { name: 'Archivos de «Documentos de cierre (opcional)»' })).toHaveTextContent('paz-y-salvo.pdf');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar ticket' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/close`)[0]?.options.body).toEqual({ visitId: VISIT, values: {}, attachments: [FILE_ID] }));
      vi.unstubAllGlobals();
    });

    it('closes the ticket and keeps the dialog open with the reason when the API refuses', async () => {
      const { fake } = renderRoute(base, { handlers: withActions(allowed('close'), { [`${base}/close`]: forbidden }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Cerrar ticket' }));
      const dialog = screen.getByRole('dialog', { name: 'Cerrar ticket' });
      typeInEditor(within(dialog).getByRole('textbox', { name: 'Comentario (opcional)' }), 'Listo');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar ticket' }));

      expect(await within(dialog).findByText('No tienes permiso para hacer esto en este ticket.')).toBeInTheDocument();
      expect(fake.callsTo(`${base}/close`)[0]?.options.body).toEqual({ visitId: VISIT, comment: '<p>Listo</p>', values: {}, attachments: [] });
    });

    it('resolves the open incident', async () => {
      const incident = { id: id(500), assignedToId: ME, createdById: OTHER, assignedTo: { id: ME, name: 'Ana Pérez' }, createdBy: { id: OTHER, name: 'Luis Gómez' }, openedAt: at, descriptionHtml: '<p>Falta el extracto.</p>' };
      const { fake } = renderRoute(base, {
        handlers: ticketHandlers({ [base]: () => detail({ status: 'PAUSED', openIncident: incident, actions: allowed('resolveIncident') }), [`${base}/incidents/${id(500)}/resolve`]: () => ({ ...mutation, incidentId: id(500) }) }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Resolver novedad' }));
      const dialog = screen.getByRole('dialog', { name: 'Resolver novedad' });
      typeInEditor(within(dialog).getByRole('textbox', { name: /Cómo se resolvió/ }), 'Llegó el extracto');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Resolver' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/incidents/${id(500)}/resolve`)[0]?.options.body).toEqual({ resolution: '<p>Llegó el extracto</p>' }));
    });

    it('signs a parallel step with an optional note', async () => {
      const { fake } = renderRoute(base, { handlers: withActions(allowed('signParallelTask'), { [`${base}/parallel-tasks/sign`]: () => mutation }) });

      const group = await screen.findByRole('group', { name: 'Acciones del ticket' });
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Firmar', 'Rechazar']);
      await userEvent.click(within(group).getByRole('button', { name: 'Firmar' }));
      const dialog = screen.getByRole('dialog', { name: 'Firmar el paso' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Firmar' }));

      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.callsTo(`${base}/parallel-tasks/sign`)[0]?.options.body).toEqual({ visitId: VISIT });
    });

    it('signs a parallel step with a signature drawn now when the profile has none', async () => {
      const FILE_ID = id(902);
      const slot = { fileId: FILE_ID, url: 'http://storage.test/bucket/sig?x=1', method: 'PUT', headers: { 'content-type': 'image/png', 'content-length': '3' }, expiresAt: at };
      const stored = { id: FILE_ID, name: 'firma.png', kind: 'IMAGE', mimeType: 'image/png', sizeBytes: 3, status: 'CONFIRMED', createdAt: at, confirmedAt: at };
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
      const { fake } = renderRoute(base, {
        handlers: withActions(allowed('signParallelTask'), {
          [`${base}/parallel-tasks/sign`]: () => mutation,
          '/auth/me/signature': () => null,
          '/files/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }),
          [`/files/${FILE_ID}/confirm`]: () => stored,
        }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Firmar' }));
      const dialog = screen.getByRole('dialog', { name: 'Firmar el paso' });
      expect(await within(dialog).findByText('No tienes firma en tu perfil: dibújala para firmar.')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Firmar' }));
      expect(within(dialog).getByText('Dibuja tu firma para continuar.')).toBeInTheDocument();
      expect(fake.callsTo(`${base}/parallel-tasks/sign`)).toHaveLength(0);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Firmar ahora' }));
      const pad = screen.getByRole('dialog', { name: 'Firma para este paso' });
      expect(within(pad).getByRole('img', { name: 'Recuadro para firmar' })).toBeInTheDocument();
      await userEvent.upload(within(pad).getByLabelText('Imagen de la firma'), new File(['png'], 'mi-firma.png', { type: 'image/png' }));
      expect(await within(dialog).findByText('Firmarás con la firma que acabas de dibujar.')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Firmar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/parallel-tasks/sign`)[0]?.options.body).toEqual({ visitId: VISIT, signatureFileId: FILE_ID }));
      vi.unstubAllGlobals();
    });

    it('asks why before rejecting a parallel step', async () => {
      const { fake } = renderRoute(base, { handlers: withActions(allowed('signParallelTask'), { [`${base}/parallel-tasks/reject`]: () => mutation }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
      const dialog = screen.getByRole('dialog', { name: 'Rechazar el paso' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }));
      expect(within(dialog).getByRole('textbox', { name: /Motivo del rechazo/ })).toHaveAccessibleDescription('Escribe por qué rechazas.');
      expect(fake.callsTo(`${base}/parallel-tasks/reject`)).toHaveLength(0);

      typeInEditor(within(dialog).getByRole('textbox', { name: /Motivo del rechazo/ }), 'El monto no cuadra');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/parallel-tasks/reject`)[0]?.options.body).toEqual({ visitId: VISIT, comment: '<p>El monto no cuadra</p>' }));
    });

    it('reports an error on the open step, saying first what the type will do', async () => {
      const errorType = (index: number, name: string, overrides: Record<string, unknown> = {}) => ({ id: id(720 + index), name, description: null, isProcessError: false, forcesClose: false, isReopening: false, isActive: true, ...overrides });
      const types = { items: [errorType(1, 'Monto mal digitado'), errorType(2, 'Soporte equivocado', { isProcessError: true }), errorType(3, 'Reapertura', { isReopening: true })], page: 1, pageSize: 100, total: 3 };
      const { fake } = renderRoute(base, {
        handlers: ticketHandlers({ [base]: () => detail({ actions: allowed('reportError') }), '/error-types': () => types, [`/error-types/${id(722)}/subtypes`]: () => ({ items: [], page: 1, pageSize: 100, total: 0 }), [`${base}/errors`]: () => mutation }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Reportar error' }));
      const dialog = await screen.findByRole('dialog', { name: 'Reportar un error' });
      const type = within(dialog).getByRole('combobox', { name: /Tipo de error/ });
      expect(within(type).getAllByRole('option').map((option) => option.textContent)).toEqual(['Elige una opción', 'Monto mal digitado', 'Soporte equivocado']);
      await userEvent.selectOptions(type, 'Soporte equivocado');
      expect(within(dialog).getByText(/vuelve al paso anterior/)).toBeInTheDocument();
      typeInEditor(within(dialog).getByRole('textbox', { name: /Qué pasó/ }), 'El soporte es de otro cliente');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reportar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/errors`)[0]?.options.body).toEqual({ visitId: VISIT, errorTypeId: id(722), description: '<p>El soporte es de otro cliente</p>' }));
    });

    it('reopens a closed ticket under a reopening error type, with its subtype', async () => {
      const errorType = (index: number, name: string, overrides: Record<string, unknown> = {}) => ({ id: id(700 + index), name, description: null, isProcessError: false, forcesClose: false, isReopening: true, isActive: true, ...overrides });
      const types = { items: [errorType(1, 'Cierre prematuro'), errorType(2, 'Error de digitación', { isReopening: false }), errorType(3, 'Inactivo', { isActive: false })], page: 1, pageSize: 100, total: 3 };
      const subtypes = { items: [{ id: id(710), errorTypeId: id(701), name: 'Faltó un soporte', description: null, isActive: true }], page: 1, pageSize: 100, total: 1 };
      const { fake } = renderRoute(base, {
        handlers: ticketHandlers({
          [base]: () => detail({ status: 'CLOSED', openVisit: null, closedAt: at, closedById: OTHER, closedBy: { id: OTHER, name: 'Luis Gómez' }, actions: allowed('reopen') }),
          '/error-types': () => types,
          [`/error-types/${id(701)}/subtypes`]: () => subtypes,
          [`${base}/reopen`]: () => mutation,
        }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Reabrir ticket' }));
      const dialog = screen.getByRole('dialog', { name: 'Reabrir ticket' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reabrir' }));
      expect(within(dialog).getByRole('combobox', { name: /Tipo de error/ })).toHaveAccessibleDescription('Elige el tipo de error.');
      expect(within(dialog).getByRole('textbox', { name: /Qué quedó mal/ })).toHaveAccessibleDescription('Describe por qué se reabre.');

      const typeSelect = within(dialog).getByRole('combobox', { name: /Tipo de error/ });
      await within(dialog).findByRole('option', { name: 'Cierre prematuro' });
      expect(within(typeSelect).getAllByRole('option').map((option) => option.textContent)).toEqual(['Elige una opción', 'Cierre prematuro']);
      await userEvent.selectOptions(typeSelect, 'Cierre prematuro');
      await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: 'Subtipo (opcional)' }), 'Faltó un soporte');
      typeInEditor(within(dialog).getByRole('textbox', { name: /Qué quedó mal/ }), 'Faltaba el extracto');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reabrir' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/reopen`)[0]?.options.body).toEqual({ errorTypeId: id(701), errorSubtypeId: id(710), description: '<p>Faltaba el extracto</p>' }));
      expect(fake.callsTo('/error-types')[0]?.path).toBe('/error-types?pageSize=100');
    });

    it('edits the subject and the priority, sending only what changed and keeping the rich description untouched', async () => {
      const priorities = { items: [{ id: id(730), name: 'Alta', sortOrder: 1, color: null, isActive: true }, { id: id(731), name: 'Retirada', sortOrder: 2, color: null, isActive: false }], page: 1, pageSize: 100, total: 2 };
      const { fake } = renderRoute(base, {
        handlers: ticketHandlers({
          '/priorities': () => priorities,
          [base]: (options) => (options.method === 'PATCH' ? { eventId: id(740) } : detail({ actions: allowed('edit') })),
        }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
      const dialog = screen.getByRole('dialog', { name: 'Editar ticket' });
      // The saved description opens in the editor with its formatting.
      expect(within(within(dialog).getByRole('textbox', { name: /Descripción/ })).getByText('1 de octubre').tagName).toBe('STRONG');
      const subject = within(dialog).getByRole('textbox', { name: /Asunto/ });
      await userEvent.clear(subject);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
      expect(subject).toHaveAccessibleDescription('Escribe el asunto.');

      await userEvent.type(subject, 'Pago de crédito de octubre');
      const priority = within(dialog).getByRole('combobox', { name: 'Prioridad' });
      await within(dialog).findByRole('option', { name: 'Alta' });
      expect(within(priority).getAllByRole('option').map((option) => option.textContent)).toEqual(['Sin prioridad', 'Alta']);
      await userEvent.selectOptions(priority, 'Alta');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

      await vi.waitFor(() => expect(fake.callsTo(base).find((call) => call.options.method === 'PATCH')?.options.body).toEqual({ title: 'Pago de crédito de octubre', priorityId: id(730) }));
      await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar ticket' })).toBeNull());
    });
  });

  describe('advance', () => {
    const VISIT = id(107);
    const APPROVE = id(620);
    const RETURN = id(621);
    const mutation = { id: TICKET, number: 'T-1042', status: 'OPEN', currentStepId: STEP, openVisitId: id(108) };
    const stepForm = (overrides: Record<string, unknown> = {}) => ({
      ...form,
      fields: [
        ...form.fields,
        field(5, 'checked', 'Monto verificado', 'CURRENCY', { currencyCode: 'COP' }),
        field(6, 'channel', 'Canal', 'SELECT', { options: [{ value: 'bank', label: 'Banco' }, { value: 'cash', label: 'Efectivo' }] }),
        field(7, 'auditor', 'Auditor', 'USER'),
      ].map((entry) => (entry.code === 'checked' ? { ...entry, isRequired: true } : entry)),
      editableFieldCodes: ['checked', 'channel'],
      decisions: [
        { transitionId: RETURN, label: 'Devolver' },
        { transitionId: APPROVE, label: 'Aprobar y avanzar' },
      ],
      ...overrides,
    });
    const handlers = (extra: Record<string, FakeHandler> = {}, formOverrides: Record<string, unknown> = {}) =>
      ticketHandlers({ [base]: () => detail({ actions: { ...noActions, advance: true } }), [`${base}/form`]: () => stepForm(formOverrides), ...extra });

    it('offers each decision of the step; a single one is the main action', async () => {
      renderRoute(base, { handlers: handlers() });
      const group = await screen.findByRole('group', { name: 'Acciones del ticket' });
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Devolver', 'Aprobar y avanzar']);
    });

    it('asks for the required data before sending, then sends the step values with the decision', async () => {
      const { fake } = renderRoute(base, { handlers: handlers({ [`${base}/transition`]: () => mutation }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      expect(within(dialog).getByText('Paso: Validación de cartera')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));
      expect(within(dialog).getByRole('textbox', { name: /Monto verificado/ })).toHaveAccessibleDescription(/Este dato es obligatorio\./);
      expect(fake.callsTo(`${base}/transition`)).toHaveLength(0);

      await userEvent.type(within(dialog).getByRole('textbox', { name: /Monto verificado/ }), '1.250.000,50');
      await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Canal' }), 'Banco');
      typeInEditor(within(dialog).getByRole('textbox', { name: 'Comentario (opcional)' }), 'Cuadra con el extracto');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.callsTo(`${base}/transition`)[0]?.options.body).toEqual({
        transitionId: APPROVE,
        visitId: VISIT,
        values: { checked: '1250000.50', channel: 'bank' },
        comment: '<p>Cuadra con el extracto</p>',
        attachments: [],
      });
    });

    it('marks the fields the API rejects and keeps the dialog open', async () => {
      const invalid = () => {
        throw new ApiError({ status: 422, code: 'FIELD_VALUES_INVALID', message: 'x', details: { issues: [{ code: 'OUT_OF_RANGE', fieldCode: 'checked' }] } });
      };
      renderRoute(base, { handlers: handlers({ [`${base}/transition`]: invalid }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Devolver' }));
      const dialog = screen.getByRole('dialog', { name: 'Devolver' });
      await userEvent.type(within(dialog).getByRole('textbox', { name: /Monto verificado/ }), '5');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Devolver' }));

      expect(await within(dialog).findByText('Revisa los datos marcados.')).toBeInTheDocument();
      expect(within(dialog).getByRole('textbox', { name: /Monto verificado/ })).toHaveAccessibleDescription(/El valor está fuera del rango permitido\./);
    });

    it('asks who receives the next step when the API says it must be chosen, then sends that person', async () => {
      let calls = 0;
      const transition = () => {
        calls += 1;
        if (calls === 1) throw new ApiError({ status: 422, code: 'ASSIGNEE_SELECTION_REQUIRED', message: 'x', details: { stepId: id(601), candidates: [{ userId: OTHER, name: 'Luis Gómez' }, { userId: id(51), name: 'Marta Ruiz' }] } });
        return mutation;
      };
      const { fake } = renderRoute(base, { handlers: handlers({ [`${base}/transition`]: transition }, { fields: [], editableFieldCodes: [] }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      const next = await within(dialog).findByRole('combobox', { name: /Quién recibe el siguiente paso/ });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));
      expect(next).toHaveAccessibleDescription(/Elige quién recibe el siguiente paso\./);
      expect(fake.callsTo(`${base}/transition`)).toHaveLength(1);

      await userEvent.selectOptions(next, 'Marta Ruiz');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.callsTo(`${base}/transition`)[1]?.options.body).toEqual({ transitionId: APPROVE, visitId: VISIT, values: {}, assigneeId: id(51), attachments: [] });
    });

    const preview = (overrides: Record<string, unknown>) => ({ outcome: 'STEP', via: [], step: { id: id(601), name: 'Tesorería', type: 'TASK' }, assignment: 'PERSON', people: [], fields: [], resumeAt: null, blocked: null, ...overrides });

    it('says before sending who receives the next step and asks to choose at once when that step needs it', async () => {
      const previews = () => preview({ assignment: 'CHOOSE', people: [{ id: OTHER, name: 'Luis Gómez' }, { id: id(51), name: 'Marta Ruiz' }], fields: ['Número de pago'], via: [{ name: 'Monto alto', blockType: 'CONDITION' }] });
      const { fake } = renderRoute(base, { handlers: handlers({ [`${base}/transition-preview`]: previews, [`${base}/transition`]: () => mutation }, { fields: [], editableFieldCodes: [] }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      const summary = await within(dialog).findByRole('region', { name: 'Qué sigue' });
      expect(summary).toHaveTextContent('Antes pasa por: Monto alto.');
      expect(summary).toHaveTextContent('Pasa a «Tesorería».');
      expect(summary).toHaveTextContent('Ese paso pide elegir quién lo recibe, entre 2 personas.');
      expect(summary).toHaveTextContent('Allá se llena: Número de pago.');
      expect(fake.callsTo(`${base}/transition-preview`)[0]?.options.body).toEqual({ transitionId: APPROVE, visitId: VISIT, values: {} });

      const next = within(dialog).getByRole('combobox', { name: /Quién recibe el siguiente paso/ });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));
      expect(next).toHaveAccessibleDescription(/Elige quién recibe el siguiente paso\./);
      expect(fake.callsTo(`${base}/transition`)).toHaveLength(0);

      await userEvent.selectOptions(next, 'Marta Ruiz');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(fake.callsTo(`${base}/transition`)[0]?.options.body).toMatchObject({ assigneeId: id(51) });
    });

    it('names the parallel signers, a hand-out in turns, the end, and warns when the workflow cannot go on', async () => {
      let answer: Record<string, unknown> = preview({ assignment: 'PARALLEL', people: [{ id: OTHER, name: 'Luis Gómez' }, { id: id(51), name: 'Marta Ruiz' }] });
      const { fake } = renderRoute(base, { handlers: handlers({ [`${base}/transition-preview`]: () => answer }, { fields: [], editableFieldCodes: [] }) });
      const open = async () => {
        await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
        return screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      };
      const close = async (dialog: HTMLElement) => {
        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      };

      let dialog = await open();
      expect(await within(dialog).findByText('Firman en paralelo: Luis Gómez, Marta Ruiz.')).toBeInTheDocument();
      expect(within(dialog).queryByRole('combobox', { name: /Quién recibe/ })).toBeNull();
      await close(dialog);

      answer = preview({ assignment: 'DISPATCH', people: Array.from({ length: 7 }, (_, index) => ({ id: id(900 + index), name: `Persona ${index + 1}` })) });
      dialog = await open();
      expect(await within(dialog).findByText('El sistema lo reparte por turnos entre 7 personas: Persona 1, Persona 2, Persona 3, Persona 4, Persona 5 y 2 más.')).toBeInTheDocument();
      await close(dialog);

      answer = preview({ outcome: 'END', step: null, assignment: null });
      dialog = await open();
      expect(await within(dialog).findByText('Con esta decisión el ticket se cierra.')).toBeInTheDocument();
      await close(dialog);

      answer = preview({ outcome: 'BLOCKED', step: null, assignment: null, blocked: { code: 'NO_ASSIGNEE_CANDIDATES', details: null } });
      dialog = await open();
      expect(await within(dialog).findByRole('status')).toHaveTextContent(/Con esta decisión el ticket no puede seguirNadie puede recibir el paso siguiente\./);
      expect(fake.callsTo(`${base}/transition-preview`).length).toBeGreaterThanOrEqual(4);
    });

    it('picks a person among what the API offers for the field, searching a long list by name, and sends the id', async () => {
      const AUDITOR = id(7 + 200);
      const people = (path: string) => {
        const q = new URL(path, 'http://x').searchParams.get('q') ?? '';
        const all = [
          { value: OTHER, label: 'Luis Gómez' },
          { value: id(51), label: 'Marta Ruiz' },
          ...Array.from({ length: 60 }, (_, index) => ({ value: id(1000 + index), label: `Persona ${index + 1}` })),
        ];
        return { options: all.filter((option) => option.label.toLowerCase().includes(q.toLowerCase())).slice(0, 50) };
      };
      const { fake } = renderRoute(base, {
        handlers: handlers({ [`/fields/${AUDITOR}/options`]: (_, path) => people(path), [`${base}/transition`]: () => mutation }, { editableFieldCodes: ['auditor'] }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      await within(dialog).findByRole('option', { name: 'Luis Gómez' });
      expect(within(dialog).getByRole('combobox', { name: 'Auditor' })).toHaveAccessibleDescription('Se muestran los primeros 50; escribe para buscar.');
      await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Buscar en «Auditor»' }), 'mar');
      await vi.waitFor(() => expect(within(dialog).queryByRole('option', { name: 'Luis Gómez' })).toBeNull(), { timeout: 2000 });
      await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Auditor' }), 'Marta Ruiz');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/transition`)[0]?.options.body).toMatchObject({ values: { auditor: id(51) } }));
      expect(fake.callsTo(`/fields/${AUDITOR}/options`).at(-1)?.path).toBe(`/fields/${AUDITOR}/options?q=mar&limit=50`);
    });

    it('offers a short list as it is, without a search box, and adds and removes several choices', async () => {
      const WATCHERS = id(210);
      const watchers = field(10, 'watchers', 'Personas a informar', 'MULTI_SELECT', {});
      const { fake } = renderRoute(base, {
        handlers: handlers(
          { [`/fields/${WATCHERS}/options`]: () => ({ options: [{ value: OTHER, label: 'Luis Gómez' }, { value: id(51), label: 'Marta Ruiz' }] }), [`${base}/transition`]: () => mutation },
          { fields: [{ ...watchers, dataSource: { kind: 'PRESET', preset: 'USERS' } }], editableFieldCodes: ['watchers'] },
        ),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      const add = within(dialog).getByRole('combobox', { name: 'Agregar a «Personas a informar»' });
      await userEvent.selectOptions(add, await within(dialog).findByRole('option', { name: 'Luis Gómez' }));
      await userEvent.selectOptions(add, 'Marta Ruiz');
      expect(within(dialog).queryByRole('searchbox')).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar Luis Gómez' }));
      expect(within(within(dialog).getByRole('list', { name: 'Elegidos en «Personas a informar»' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Marta Ruiz×']);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/transition`)[0]?.options.body).toMatchObject({ values: { watchers: [id(51)] } }));
    });

    it('fills a table row by row, drops blank rows and says which cell the API rejects', async () => {
      const items = { ...field(9, 'items', 'Ítems', 'TABLE', { columns: [{ code: 'item', label: 'Ítem', type: 'TEXT' }, { code: 'price', label: 'Precio', type: 'CURRENCY' }] }) };
      const rejected = () => {
        throw new ApiError({ status: 422, code: 'FIELD_VALUES_INVALID', message: 'x', details: { issues: [{ code: 'OUT_OF_RANGE', fieldCode: 'items', row: 0, column: 'price' }] } });
      };
      const { fake } = renderRoute(base, { handlers: handlers({ [`${base}/transition`]: rejected }, { fields: [items], editableFieldCodes: ['items'] }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      expect(within(dialog).getByText('Sin filas.')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar fila' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar fila' }));
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Ítem, fila 2' }), 'Papel');
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Precio, fila 2' }), '1.200,50');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/transition`)[0]?.options.body).toMatchObject({ values: { items: [{ item: 'Papel', price: '1200.50' }] } }));
      expect(await within(dialog).findByText('Fila 1, «Precio»: El valor está fuera del rango permitido.')).toBeInTheDocument();
      expect(within(dialog).getByRole('textbox', { name: 'Ítem, fila 1' })).toHaveValue('Papel');
      expect(within(dialog).queryByRole('textbox', { name: 'Ítem, fila 2' })).toBeNull();
    });

    it('shows a formula column computed from its row as it is typed, and does not send it', async () => {
      const count = { ...field(9, 'count', 'Conteo', 'TABLE', { columns: [{ code: 'QTY', label: 'Cantidad', type: 'NUMBER' }, { code: 'VALUE', label: 'Valor', type: 'CURRENCY' }, { code: 'SUB', label: 'Subtotal', type: 'FORMULA', expression: 'QTY * VALUE' }] }) };
      const { fake } = renderRoute(base, { handlers: handlers({ [`${base}/transition`]: () => mutation }, { fields: [count], editableFieldCodes: ['count'] }) });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar fila' }));
      const subtotal = within(dialog).getByRole('status', { name: 'Subtotal, fila 1' });
      expect(subtotal).toHaveTextContent('–');
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Cantidad, fila 1' }), '3');
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Valor, fila 1' }), '50.000');
      expect(subtotal).toHaveTextContent('150.000');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/transition`)).toHaveLength(1));
      expect((fake.callsTo(`${base}/transition`)[0]?.options.body as { values: { count: unknown[] } }).values.count).toEqual([{ QTY: '3', VALUE: '50000' }]);
    });

    it('uploads a file as soon as it is chosen and sends its id with the step', async () => {
      const FILE_ID = id(900);
      const slot = { fileId: FILE_ID, url: 'http://storage.test/bucket/key?sig=1', method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '4' }, expiresAt: at };
      const stored = { id: FILE_ID, name: 'extracto.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 4, status: 'CONFIRMED', createdAt: at, confirmedAt: at };
      const put = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
      vi.stubGlobal('fetch', put);
      const receipt = { ...field(8, 'receipt', 'Soporte', 'FILE', { maxFiles: 1, accept: ['PDF'] }), isRequired: true };
      const { fake } = renderRoute(base, {
        handlers: handlers(
          { '/files/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }), [`/files/${FILE_ID}/confirm`]: () => stored, [`${base}/transition`]: () => mutation },
          { editableFieldCodes: ['receipt'], fields: [receipt] },
        ),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Devolver' }));
      const dialog = screen.getByRole('dialog', { name: 'Devolver' });
      const input = within(dialog).getByLabelText('Adjuntar un archivo');
      expect(input).toHaveAttribute('accept', '.pdf');
      await userEvent.upload(input, new File(['nope'], 'foto.png', { type: 'image/png' }), { applyAccept: false });
      expect(within(dialog).getByText('«foto.png» no es de un tipo permitido aquí.')).toBeInTheDocument();

      await userEvent.upload(input, new File(['%PDF'], 'extracto.pdf', { type: 'application/pdf' }));
      expect(await within(dialog).findByRole('list', { name: 'Archivos de «Soporte»' })).toHaveTextContent('extracto.pdf');
      expect(put).toHaveBeenCalledWith(slot.url, expect.objectContaining({ method: 'PUT', headers: { 'content-type': 'application/pdf' } }));
      expect(within(dialog).queryByLabelText('Adjuntar un archivo')).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Devolver' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/transition`)[0]?.options.body).toMatchObject({ values: { receipt: [FILE_ID] } }));
      vi.unstubAllGlobals();
    });

    it('uploads a file into a table cell and sends it in its row', async () => {
      const FILE_ID = id(901);
      const slot = { fileId: FILE_ID, url: 'http://storage.test/bucket/key?sig=2', method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '4' }, expiresAt: at };
      const stored = { id: FILE_ID, name: 'taxi.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 4, status: 'CONFIRMED', createdAt: at, confirmedAt: at };
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
      const receipts = { ...field(9, 'receipts', 'Gastos', 'TABLE', { columns: [{ code: 'ITEM', label: 'Gasto', type: 'TEXT' }, { code: 'PROOF', label: 'Soporte', type: 'FILE', accept: ['PDF'] }] }) };
      const { fake } = renderRoute(base, {
        handlers: handlers({ '/files/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }), [`/files/${FILE_ID}/confirm`]: () => stored, [`${base}/transition`]: () => mutation }, { fields: [receipts], editableFieldCodes: ['receipts'] }),
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Aprobar y avanzar' }));
      const dialog = screen.getByRole('dialog', { name: 'Aprobar y avanzar' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar fila' }));
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Gasto, fila 1' }), 'Taxi');
      const cell = within(dialog).getByLabelText('Soporte, fila 1');
      expect(cell).toHaveAttribute('accept', '.pdf');
      await userEvent.upload(cell, new File(['%PDF'], 'taxi.pdf', { type: 'application/pdf' }));
      expect(await within(dialog).findByText('taxi.pdf')).toBeInTheDocument();
      expect(within(dialog).queryByLabelText('Soporte, fila 1')).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar y avanzar' }));

      await vi.waitFor(() => expect(fake.callsTo(`${base}/transition`)[0]?.options.body).toMatchObject({ values: { receipts: [{ ITEM: 'Taxi', PROOF: [FILE_ID] }] } }));
      vi.unstubAllGlobals();
    });
  });
});
