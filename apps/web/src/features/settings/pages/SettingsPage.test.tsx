import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const grant = (status: 'ACTIVE' | 'EXPIRED' | 'REVOKED', overrides: Record<string, unknown> = {}) => ({
  id: id(1),
  status,
  reason: 'Revisar un flujo',
  grantedBy: { userId: id(2), name: 'Ana Torres' },
  startsAt: at,
  expiresAt: '2026-10-22T15:00:00.000Z',
  revokedAt: null,
  revokedBy: null,
  visits: [],
  requests: 0,
  ...overrides,
});

describe('SettingsPage', () => {
  it('requires two-step verification for everyone and says who still lacks it', async () => {
    let mfaRequired = false;
    const { fake } = renderRoute('/settings', {
      handlers: {
        '/settings/security': (options) => {
          if (options.method === 'PUT') mfaRequired = (options.body as { mfaRequired: boolean }).mfaRequired;
          return { mfaRequired, activeMembersWithoutMfa: 3 };
        },
      },
    });

    const box = await screen.findByRole('checkbox', { name: /Exigir verificación en dos pasos/ });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/settings/security' && call.options.method === 'PUT')?.options.body).toEqual({ mfaRequired: true }));
    expect(await screen.findByText('3 personas activas todavía no la tienen configurada.')).toBeInTheDocument();
  });

  it('turns the AI assistant on only after the transfer notice is accepted, and shows what it costs', async () => {
    let enabled = false;
    const settings = () => ({ available: true, enabled, noticeVersion: 4, limits: { jobsPerDay: 10, tokensPerDay: 1_000_000 }, today: { jobs: 2, tokens: 24_500 } });
    const { fake } = renderRoute('/settings/ai', {
      handlers: {
        '/settings/ai-assistant': (options) => {
          if (options.method === 'PUT') enabled = (options.body as { enabled: boolean }).enabled;
          return settings();
        },
        '/settings/ai-assistant/usage': () => ({
          days: [{ date: '2026-10-27', model: 'deepseek-v4-pro', calls: 3, promptTokens: 10_500, completionTokens: 14_000, reasoningTokens: 9_000 }],
          recentJobs: [{ id: id(9), status: 'SUCCEEDED', errorCode: null, requesterName: 'Ana Torres', model: 'deepseek-v4-pro', tokens: 24_500, createdAt: at, completedAt: at }],
        }),
      },
    });

    expect(await screen.findByText(/servidores en Estados Unidos/)).toBeInTheDocument();
    expect(screen.getByText(/quedan guardadas 90 días en el historial de cada borrador, visibles solo dentro de la organización/)).toBeInTheDocument();
    const turnOn = screen.getByRole('button', { name: 'Activar el asistente' });
    expect(turnOn).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Leí este aviso/ }));
    await userEvent.click(turnOn);
    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/settings/ai-assistant' && call.options.method === 'PUT')?.options.body).toEqual({ enabled: true, acceptedNoticeVersion: 4 }));
    expect(await screen.findByText('Hoy: 2 de 10 solicitudes · 24.500 de 1.000.000 tokens.')).toBeInTheDocument();
    expect(screen.getByText('Activado')).toBeInTheDocument();
    expect(screen.getByText(/quedan guardadas 90 días/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Últimas solicitudes' })).toHaveTextContent('Ana Torres');
    expect(screen.getByRole('table', { name: 'Consumo de los últimos 30 días' })).toHaveTextContent('deepseek-v4-pro');

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar el asistente' }));
    await vi.waitFor(() => expect(fake.calls.filter((call) => call.options.method === 'PUT').at(-1)?.options.body).toEqual({ enabled: false }));
    expect(await screen.findByRole('button', { name: 'Activar el asistente' })).toBeDisabled();
  });

  it('sets which notices may go out by e-mail, type by type, saving each choice at once', async () => {
    let rows = ['TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_TRANSITIONED', 'TICKET_COMMENTED', 'TICKET_CLOSED', 'TICKET_REOPENED', 'INCIDENT_OPENED', 'INCIDENT_RESOLVED', 'SLA_WARNING', 'SLA_OVERDUE', 'OBSERVER_UPDATE', 'SYSTEM'].map((type) => ({
      type,
      policy: type === 'TICKET_ASSIGNED' || type === 'SYSTEM' ? 'DEFAULT_ON' : 'DEFAULT_OFF',
      chosen: false,
    }));
    const { fake } = renderRoute('/settings/emails', {
      handlers: {
        '/settings/notification-emails': () => rows,
        '/settings/notification-emails/TICKET_CLOSED': (options) => {
          const saved = { type: 'TICKET_CLOSED', policy: (options.body as { policy: string }).policy, chosen: true };
          rows = rows.map((row) => (row.type === saved.type ? saved : row));
          return saved;
        },
      },
    });

    const closed = await screen.findByRole('combobox', { name: 'Se cerró un ticket' });
    expect(closed).toHaveValue('DEFAULT_OFF');
    expect(closed).toHaveAccessibleDescription(/Valor de fábrica/);
    expect(screen.getByRole('combobox', { name: 'Te asignaron un ticket' })).toHaveValue('DEFAULT_ON');
    expect(screen.queryByRole('combobox', { name: 'Espacio de almacenamiento' })).not.toBeInTheDocument();

    await userEvent.selectOptions(closed, 'Nunca por correo');
    await vi.waitFor(() => expect(fake.callsTo('/settings/notification-emails/TICKET_CLOSED')[0]?.options).toMatchObject({ method: 'PUT', body: { policy: 'OFF' } }));
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'Se cerró un ticket' })).toHaveValue('OFF'));
    expect(screen.getByRole('combobox', { name: 'Se cerró un ticket' })).not.toHaveAccessibleDescription(/Valor de fábrica/);
  });

  it('says the AI assistant is not offered when the platform has it off', async () => {
    renderRoute('/settings/ai', { handlers: { '/settings/ai-assistant': () => ({ available: false, enabled: false, noticeVersion: 4, limits: { jobsPerDay: 10, tokensPerDay: 1_000_000 }, today: { jobs: 0, tokens: 0 } }) } });
    expect(await screen.findByText('El asistente de IA todavía no está disponible en la plataforma.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar el asistente' })).not.toBeInTheDocument();
  });

  it('names its own rate tables and slots, checks them first, and turns the calculator off', async () => {
    let config: Record<string, unknown> | null = { tables: [{ code: 'COMIDAS', name: 'Comidas', slots: [{ name: 'Desayuno', from: '06:00', to: '09:00', amount: '15000' }] }] };
    const calculator = () => ({ code: 'TIME_SLOTS', parameters: [{ name: 'departure', type: 'DATETIME', required: true }, { name: 'return', type: 'DATETIME', required: true }], output: 'CURRENCY', configured: config !== null, config });
    const { fake } = renderRoute('/settings/calculators', {
      handlers: {
        '/calculators': () => [calculator()],
        '/calculators/TIME_SLOTS/config': (options) => {
          config = options.method === 'DELETE' ? null : (options.body as Record<string, unknown>);
          return calculator();
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Pago por franjas horarias' })).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    const meals = screen.getByRole('group', { name: 'Tarifa 1' });
    expect(within(meals).getByRole('textbox', { name: 'Nombre de la tarifa' })).toHaveValue('Comidas');
    // A stored table keeps its code: flows pick it by that code.
    expect(within(meals).getByRole('textbox', { name: /^Código/ })).toHaveAttribute('readonly');

    await userEvent.click(screen.getByRole('button', { name: 'Agregar tarifa' }));
    const night = screen.getByRole('group', { name: 'Tarifa 2' });
    await userEvent.type(within(night).getByRole('textbox', { name: 'Nombre de la tarifa' }), 'Recargo nocturno');
    expect(within(night).getByRole('textbox', { name: /^Código/ })).toHaveValue('RECARGO_NOCTURNO');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(within(night).getByRole('textbox', { name: 'Franja' })).toHaveAccessibleDescription('Escribe el nombre de la franja.');
    expect(fake.calls.filter((call) => call.options.method === 'PUT')).toHaveLength(0);

    const slot = within(night).getByRole('group', { name: 'Franja 1 de Recargo nocturno' });
    await userEvent.type(within(slot).getByRole('textbox', { name: 'Franja' }), 'Noche');
    await userEvent.type(within(slot).getByLabelText('Desde'), '22:00');
    await userEvent.type(within(slot).getByLabelText('Hasta'), '06:00');
    await userEvent.type(within(slot).getByRole('textbox', { name: 'Valor' }), '30000');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(fake.calls.find((call) => call.options.method === 'PUT')?.options.body).toEqual({
        tables: [
          { code: 'COMIDAS', name: 'Comidas', slots: [{ name: 'Desayuno', from: '06:00', to: '09:00', amount: '15000' }] },
          { code: 'RECARGO_NOCTURNO', name: 'Recargo nocturno', slots: [{ name: 'Noche', from: '22:00', to: '06:00', amount: '30000' }] },
        ],
      }),
    );
    expect(await screen.findByText('Configuración guardada.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(await screen.findByText('Apagada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar' })).toBeInTheDocument();
  });

  it('gives support access for some hours with a reason, and ends it', async () => {
    let active: ReturnType<typeof grant> | null = null;
    const { fake } = renderRoute('/settings/support', {
      handlers: {
        '/settings/support-access': (options) => {
          if (options.method === 'POST') active = grant('ACTIVE', { reason: (options.body as { reason: string }).reason });
          if (options.method === 'DELETE') active = null;
          return { active, history: active === null ? [grant('REVOKED')] : [active] };
        },
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Dar acceso' }));
    expect(screen.getByText('Escribe el motivo (al menos 3 caracteres).')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: /Durante cuántas horas/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /Durante cuántas horas/ }), '8');
    await userEvent.type(screen.getByRole('textbox', { name: /Motivo/ }), 'Revisar un flujo');
    await userEvent.click(screen.getByRole('button', { name: 'Dar acceso' }));

    await vi.waitFor(() => expect(fake.calls.find((call) => call.path === '/settings/support-access' && call.options.method === 'POST')?.options.body).toEqual({ hours: 8, reason: 'Revisar un flujo' }));
    expect(await screen.findByText(/El soporte tiene acceso hasta/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Terminar el acceso ahora' }));
    expect(await screen.findByRole('button', { name: 'Dar acceso' })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Accesos anteriores' })).getByText('Terminado')).toBeInTheDocument();
  });

  it('opens the storage tab from the e-mail link and shows the space used', async () => {
    renderRoute('/settings/storage', { handlers: { '/storage/usage': () => ({ usedBytes: '5242880', reservedBytes: '0', limitBytes: '10485760', hardLimitBytes: '11010048', activeUsers: 4, state: 'OK' }) } });

    expect(await screen.findByText('Usados 5 MB de 10 MB (50 %).')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Espacio usado' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('tab', { name: 'Almacenamiento' })).toHaveAttribute('aria-selected', 'true');
  });

  it('lists the audit log in Spanish, opens what an entry changed and loads more', async () => {
    const entry = (index: number, action: string) => ({ id: id(100 + index), at, actor: { id: id(2), name: 'Ana Torres' }, supportGrantId: null, action, subjectType: 'Role', subjectId: id(3), before: { name: 'Agente' }, after: { name: 'Agente senior' }, ipAddress: '10.0.0.1', userAgent: null, requestId: 'req-1' });
    const { fake } = renderRoute('/settings/audit', {
      handlers: {
        '/audit-logs': (_options, path) => (path.includes('cursor=') ? { items: [entry(2, 'member.invited')], nextCursor: null } : { items: [entry(1, 'role.updated')], nextCursor: id(101) }),
      },
    });

    const table = await screen.findByRole('table', { name: 'Registro de auditoría' });
    expect(await within(table).findByText('Editó un rol')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: 'Detalle de «Editó un rol»' }));
    expect(screen.getByText(/"Agente senior"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await within(table).findByText('Invitó a una persona')).toBeInTheDocument();
    expect(fake.callsTo('/audit-logs').at(-1)?.path).toBe(`/audit-logs?limit=50&cursor=${id(101)}`);
  });

  it('only offers the tabs the role may use, and says why a change was refused', async () => {
    renderRoute('/settings', {
      handlers: {
        '/auth/me/permissions': () => ({ permissions: [{ action: 'update', subject: 'Setting', conditional: false }] }),
        '/settings/security': (options) => {
          if (options.method === 'PUT') throw new ApiError({ status: 403, code: 'FORBIDDEN', message: 'x' });
          return { mfaRequired: false, activeMembersWithoutMfa: 0 };
        },
      },
    });

    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual(['Seguridad', 'Organización', 'Calculadoras', 'Correos', 'Asistente de IA']);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Exigir verificación en dos pasos/ }));
    expect(await screen.findByText('Tu rol no puede hacer este cambio.')).toBeInTheDocument();
  });

  it('shows the platform notices above the page, each closable', async () => {
    renderRoute('/settings', { handlers: { '/announcements': () => [{ id: id(9), type: 'MAINTENANCE', title: 'Mantenimiento el sábado', body: 'De 2 a 4 a. m.', startsAt: at, endsAt: null, blocksLogin: false }], '/settings/security': () => ({ mfaRequired: false, activeMembersWithoutMfa: 0 }) } });

    expect(await screen.findByText('Mantenimiento el sábado')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar el aviso «Mantenimiento el sábado»' }));
    expect(screen.queryByText('Mantenimiento el sábado')).toBeNull();
  });
});
