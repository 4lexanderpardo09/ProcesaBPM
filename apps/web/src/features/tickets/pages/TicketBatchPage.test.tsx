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
});
const group = { workflowVersionId: id(1), stepId: STEP, stepName: 'Tesorería', workflowName: 'Viáticos', maxTickets: 2, decisions: [{ transitionId: PAID, label: 'Pagado' }], tickets: [ticket(1, 'Ana Pérez'), ticket(2, 'Luis Gómez'), ticket(3, 'Olga Ruiz')] };
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

  it('says when there is nothing to answer in a batch', async () => {
    renderRoute('/tickets/batch', { handlers: { '/ticket-batches': () => [] } });
    expect(await screen.findByText('No tienes tickets en pasos que se atiendan en lote.')).toBeInTheDocument();
  });
});
