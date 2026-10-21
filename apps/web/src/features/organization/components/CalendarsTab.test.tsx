import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api';
import type { FakeHandler } from '@/test/fake-transport';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const at = '2026-10-21T15:00:00.000Z';
const MAIN = id(40);
const NIGHT = id(41);

const page = <T,>(items: readonly T[]) => ({ items, page: 1, pageSize: 100, total: items.length });
const calendar = (calendarId: string, name: string, isDefault: boolean, countryCode: string | null = 'CO') => ({ id: calendarId, name, countryCode, isDefault, createdAt: at });
const weekdays = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, startTime: '08:00', endTime: '12:00' },
  { weekday, startTime: '14:00', endTime: '18:00' },
]);
const grant = (action: string, subject: string) => ({ action, subject, conditional: false });

function handlers(extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    '/calendars': () => page([calendar(MAIN, 'Colombia', true), calendar(NIGHT, 'Turno noche', false, null)]),
    '/countries': () => [{ code: 'CO', name: 'Colombia', currencyCode: 'COP', timeZone: 'America/Bogota' }],
    [`/calendars/${MAIN}`]: () => ({ ...calendar(MAIN, 'Colombia', true), workingHours: weekdays }),
    [`/calendars/${MAIN}/holidays`]: () => [{ date: '2026-10-12', name: 'Día de la Raza' }],
    [`/calendars/${NIGHT}`]: () => ({ ...calendar(NIGHT, 'Turno noche', false, null), workingHours: [] }),
    [`/calendars/${NIGHT}/holidays`]: () => [],
    ...extra,
  };
}

/** The first render loads the lazy page: under a full parallel run that can take more than the default second. */
const FIRST_RENDER = { timeout: 5000 };

const open = (path = '/organization?tab=calendars', extra: Record<string, FakeHandler> = {}) => renderRoute(path, { handlers: handlers(extra) });

describe('CalendarsTab', () => {
  it('shows the default calendar with its week, Monday first, and its holidays', async () => {
    open();

    const hours = await screen.findByRole('list', { name: 'Horario laboral' }, FIRST_RENDER);
    await within(hours).findByText('Lunes');
    expect(within(hours).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Lunes08:00–12:00, 14:00–18:00Editar',
      'Martes08:00–12:00, 14:00–18:00Editar',
      'Miércoles08:00–12:00, 14:00–18:00Editar',
      'Jueves08:00–12:00, 14:00–18:00Editar',
      'Viernes08:00–12:00, 14:00–18:00Editar',
      'SábadoNo laborableEditar',
      'DomingoNo laborableEditar',
    ]);
    expect(screen.getByText('40 h de trabajo a la semana.')).toBeInTheDocument();
    expect(await screen.findByText('Día de la Raza')).toBeInTheDocument();
    expect(screen.getByText('lunes, 12 de octubre')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horario y festivos de «Colombia»' })).toBeInTheDocument();
  });

  it('gives Saturday a morning, refusing slots that overlap', async () => {
    const { fake } = open('/organization?tab=calendars', { [`/calendars/${MAIN}/working-hours/6`]: () => ({ ...calendar(MAIN, 'Colombia', true), workingHours: weekdays }) });

    await userEvent.click(await screen.findByRole('button', { name: 'Editar el horario del sábado' }, FIRST_RENDER));
    const dialog = screen.getByRole('dialog', { name: 'Horario del sábado' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar franja' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar franja' }));
    const [first, second] = within(dialog).getAllByRole('group');
    if (first === undefined || second === undefined) throw new Error('two slots expected');
    await userEvent.type(within(first).getByLabelText(/Desde/), '08:00');
    await userEvent.type(within(first).getByLabelText(/Hasta/), '12:00');
    await userEvent.type(within(second).getByLabelText(/Desde/), '11:00');
    await userEvent.type(within(second).getByLabelText(/Hasta/), '13:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(second).getByLabelText(/Desde/)).toHaveAccessibleDescription('Se cruza con otra franja.');
    expect(fake.callsTo(`/calendars/${MAIN}/working-hours/6`)).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar la franja 2' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(fake.callsTo(`/calendars/${MAIN}/working-hours/6`)[0]?.options).toMatchObject({ method: 'PUT', body: { slots: [{ startTime: '08:00', endTime: '12:00' }] } }));
  });

  it('imports the holidays of the country, and says a day is already a holiday', async () => {
    const { fake } = open('/organization?tab=calendars', {
      [`/calendars/${MAIN}/holidays/import`]: () => ({ imported: 18 }),
      [`/calendars/${MAIN}/holidays`]: (options) => {
        if (options.method === 'POST') throw new ApiError({ status: 409, code: 'DUPLICATE', message: 'taken' });
        return [{ date: '2026-10-12', name: 'Día de la Raza' }];
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Importar los de Colombia' }));
    expect(await screen.findByText(/Se importaron 18 festivos de \d{4}\./)).toBeInTheDocument();
    expect(fake.callsTo(`/calendars/${MAIN}/holidays/import`)[0]?.options.body).toEqual({ year: new Date().getFullYear() });

    await userEvent.click(screen.getByRole('button', { name: 'Agregar festivo' }));
    const dialog = screen.getByRole('dialog', { name: 'Agregar festivo' });
    await userEvent.type(within(dialog).getByLabelText(/Fecha/), '2026-10-12');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Puente');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await within(dialog).findByText('Ese día ya es festivo en este calendario.')).toBeInTheDocument();
  });

  it('a calendar without a country cannot import, and is shown on request', async () => {
    open();

    await userEvent.click(await screen.findByRole('button', { name: 'Ver horario y festivos de Turno noche' }));

    expect(await screen.findByRole('heading', { name: 'Horario y festivos de «Turno noche»' })).toBeInTheDocument();
    expect(await screen.findByText(/ponle un país al calendario/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Importar/ })).toBeNull();
    expect(screen.getByText('0 h de trabajo a la semana.')).toBeInTheDocument();
  });

  it('previews when a deadline would fall', async () => {
    const { fake } = open('/organization?tab=calendars', { [`/calendars/${MAIN}/preview`]: () => ({ dueDate: '2026-10-22T21:00:00.000Z', businessMinutes: 960, timeZone: 'America/Bogota' }) });

    const amount = await screen.findByRole('textbox', { name: /Plazo/ });
    await userEvent.clear(amount);
    await userEvent.type(amount, '2');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'En' }), 'Días hábiles');
    await userEvent.click(screen.getByRole('button', { name: 'Calcular' }));

    expect(await screen.findByText(/Vence el 22 de octubre de 2026.*4:00.*\(hora de America\/Bogota\)\./)).toBeInTheDocument();
    expect(fake.callsTo(`/calendars/${MAIN}/preview`)[0]?.options.body).toMatchObject({ amount: 2, unit: 'BUSINESS_DAYS' });
  });

  it('deletes a calendar that is not the default one', async () => {
    const { fake } = open('/organization?tab=calendars', { [`/calendars/${NIGHT}`]: (options) => (options.method === 'DELETE' ? undefined : { ...calendar(NIGHT, 'Turno noche', false, null), workingHours: [] }) });

    const table = await screen.findByRole('table', { name: 'Calendarios' });
    await within(table).findByText('Turno noche');
    expect(within(table).queryByRole('button', { name: 'Eliminar Colombia' })).toBeNull();
    await userEvent.click(within(table).getByRole('button', { name: 'Eliminar Turno noche' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar «Turno noche»' })).getByRole('button', { name: 'Eliminar' }));

    await vi.waitFor(() => expect(fake.callsTo(`/calendars/${NIGHT}`).some((call) => call.options.method === 'DELETE')).toBe(true));
  });

  it('a role that can only read sees the calendars without editing them', async () => {
    open('/organization?tab=calendars', { '/auth/me/permissions': () => ({ permissions: [grant('read', 'Calendar')] }) });

    await screen.findByRole('list', { name: 'Horario laboral' });
    await screen.findByText('Día de la Raza');
    expect(screen.queryByRole('button', { name: /Editar|Agregar|Importar|Quitar|Eliminar|Nuevo/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Calcular' })).toBeInTheDocument();
  });
});
