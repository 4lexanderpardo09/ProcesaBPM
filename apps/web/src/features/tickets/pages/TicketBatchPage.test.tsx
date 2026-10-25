import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const STEP = id(10);
const PAID = id(20);
const ticket = (index: number, name: string) => ({
  id: id(100 + index),
  number: `T-${String(1000 + index)}`,
  title: `Pago ${String(index)}`,
  visitId: id(200 + index),
  requester: { id: id(300 + index), name },
  companyName: 'Arpesod',
  createdAt: '2026-10-20T15:00:00.000Z',
  dueAt: null,
  values: {},
  subgroup: null,
});
const group = { workflowVersionId: id(1), stepId: STEP, stepName: 'Tesorería', workflowName: 'Viáticos', maxTickets: 2, title: null, shownFields: [], groupBy: null, groupField: null, decisions: [{ transitionId: PAID, label: 'Pagado' }], tickets: [ticket(1, 'Ana Pérez'), ticket(2, 'Luis Gómez'), ticket(3, 'Olga Ruiz')] };
const form = {
  ticketId: id(101),
  versionId: id(1),
  visitId: id(201),
  step: { id: STEP, name: 'Tesorería', type: 'TASK', description: null, closeRule: 'NOT_ALLOWED' },
  fields: [
    { id: id(400), stepId: STEP, code: 'METHOD', label: 'Medio de pago', type: 'TEXT', isRequired: true, isReadOnly: false, sortOrder: 1, config: {}, dataSource: null },
    { id: id(401), stepId: STEP, code: 'RECEIPT', label: 'Soporte', type: 'FILE', isRequired: false, isReadOnly: false, sortOrder: 2, config: {}, dataSource: null },
  ],
  editableFieldCodes: ['METHOD', 'RECEIPT'],
  decisions: [{ transitionId: PAID, label: 'Pagado' }],
};
const mutation = (index: number) => ({ id: id(100 + index), number: `T-${String(1000 + index)}`, status: 'CLOSED', currentStepId: null, openVisitId: null });

describe('TicketBatchPage', () => {
  it('answers the chosen tickets of a step at once, with the step data filled once, and says which stayed and why', async () => {
    const { fake } = renderRoute('/tickets/batch', {
      handlers: {
        '/ticket-batches': () => [group],
        [`/tickets/${id(101)}/form`]: () => form,
        '/ticket-batches/transition': () => ({
          results: [
            { ticketId: id(101), ok: true, ticket: mutation(1) },
            { ticketId: id(103), ok: false, error: { code: 'FIELD_VALUES_INVALID', message: 'x' } },
          ],
        }),
      },
    });

    const card = (await screen.findByRole('heading', { name: 'Tesorería · Viáticos' })).closest('section') ?? document.body;
    const pay = within(card as HTMLElement).getByRole('button', { name: 'Pagado' });
    expect(pay).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Elegir los 3' }));
    expect(screen.getByText('Este paso acepta hasta 2 tickets por lote.')).toBeInTheDocument();
    expect(pay).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Elegir el ticket T-1002' }));
    await userEvent.click(pay);

    const dialog = await screen.findByRole('dialog', { name: 'Pagado: 2 tickets' });
    expect(await within(dialog).findByRole('textbox', { name: /Medio de pago/ })).toBeInTheDocument();
    expect(within(dialog).queryByText('Soporte')).toBeNull();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Medio de pago/ }), 'Transferencia');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pagado' }));

    await vi.waitFor(() =>
      expect(fake.callsTo('/ticket-batches/transition')[0]?.options.body).toEqual({
        transitionId: PAID,
        items: [
          { ticketId: id(101), visitId: id(201) },
          { ticketId: id(103), visitId: id(203) },
        ],
        values: { METHOD: 'Transferencia' },
      }),
    );
    const result = await screen.findByRole('dialog', { name: 'Resultado del lote' });
    expect(within(result).getByText('1 ticket avanzó.')).toBeInTheDocument();
    expect(within(result).getByText(/los datos del paso no sirven para este ticket/)).toHaveTextContent('T-1003 · los datos del paso no sirven para este ticket.');
  });

  it('reads the tray as the step asks: its title, the data beside each ticket and its parts, each chosen at once', async () => {
    const at = (index: number, site: { key: string; name: string }, amount: string) => ({ ...ticket(index, 'Ana Pérez'), values: { AMOUNT: amount }, subgroup: site });
    const north = { key: id(50), name: 'Barranquilla' };
    const none = { key: '', name: '' };
    const tray = {
      ...group,
      maxTickets: 10,
      title: 'Pagos del día',
      groupBy: 'REQUESTER_SITE',
      shownFields: [{ code: 'AMOUNT', label: 'Monto', type: 'CURRENCY', config: { currencyCode: 'COP' } }],
      tickets: [at(1, none, '1250000.00'), at(2, north, '80000.00'), at(3, north, '5000.00')],
    };
    const { fake } = renderRoute(`/tickets/batch?cutoff=${id(60)}`, { handlers: { '/ticket-batches': () => [tray] } });

    expect(await screen.findByRole('heading', { name: 'Pagos del día · Viáticos' })).toBeInTheDocument();
    expect(new URLSearchParams(fake.callsTo('/ticket-batches')[0]!.path.split('?')[1]).get('cutoffId')).toBe(id(60));
    expect(screen.getByText('Solo los tickets que salieron en un archivo del plano.')).toBeInTheDocument();
    const parts = screen.getAllByRole('region').filter((region) => ['Barranquilla', 'Sin sede'].includes(region.getAttribute('aria-label') ?? ''));
    expect(parts.map((region) => region.getAttribute('aria-label'))).toEqual(['Barranquilla', 'Sin sede']);
    expect(within(parts[1]!).getByRole('columnheader', { name: 'Monto' })).toBeInTheDocument();
    expect(within(parts[1]!).getByText(/1\.250\.000/)).toBeInTheDocument();

    await userEvent.click(within(parts[0]!).getByRole('checkbox', { name: 'Elegir estos 2' }));
    expect(screen.getByText('2 elegidos de máximo 10 por lote')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Elegir el ticket T-1001' })).not.toBeChecked();
  });

  it('splits the tray by a field, naming each part as the field writes its value', async () => {
    const at = (index: number, bank: string | undefined) => ({ ...ticket(index, 'Ana Pérez'), values: bank === undefined ? {} : { BANK: bank }, subgroup: bank === undefined ? { key: '', name: '' } : { key: JSON.stringify(bank), name: bank } });
    const options = [{ value: 'B1', label: 'Bancolombia' }, { value: 'B2', label: 'Davivienda' }];
    const tray = { ...group, maxTickets: 10, groupBy: 'FIELD', groupField: { code: 'BANK', label: 'Banco', type: 'SELECT', config: { options } }, tickets: [at(1, undefined), at(2, 'B2'), at(3, 'B1')] };
    renderRoute('/tickets/batch', { handlers: { '/ticket-batches': () => [tray] } });

    await screen.findByRole('heading', { name: 'Tesorería · Viáticos' });
    const parts = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')).filter((name) => ['Bancolombia', 'Davivienda', 'Sin dato'].includes(name ?? ''));
    expect(parts).toEqual(['Davivienda', 'Bancolombia', 'Sin dato']);
  });

  it('says when there is nothing to answer in a batch', async () => {
    renderRoute('/tickets/batch', { handlers: { '/ticket-batches': () => [] } });
    expect(await screen.findByText('No tienes tickets en pasos que se atiendan en lote.')).toBeInTheDocument();
  });
});
