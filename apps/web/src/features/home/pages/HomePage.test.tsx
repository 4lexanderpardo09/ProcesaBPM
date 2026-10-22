import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/render-route';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;

describe('HomePage', () => {
  it('greets the person, shows their counters and the tickets waiting on them, the overdue marked', async () => {
    renderRoute('/', {
      handlers: {
        '/dashboard/stats': () => ({ myOpen: 4, myOverdue: 1, myDueSoon: 2, createdByMeOpen: 3, closedByMeWeek: 7 }),
        '/dashboard/pending': () => [
          { id: id(1), number: 'PAG-0012', title: 'Confirmación de pago', status: 'OPEN', currentStepId: null, createdAt: '2026-10-20T15:00:00.000Z', dueAt: '2026-10-21T15:00:00.000Z', overdue: true },
          { id: id(2), number: 'PAG-0015', title: 'Devolución', status: 'PAUSED', currentStepId: null, createdAt: '2026-10-20T15:00:00.000Z', dueAt: null, overdue: false },
        ],
      },
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeInTheDocument();
    const stats = screen.getByRole('region', { name: 'Resumen' });
    expect(await within(stats).findByRole('link', { name: /4\s*Asignados a mí/ })).toHaveAttribute('href', '/tickets');
    expect(within(stats).getByRole('link', { name: /3\s*Mis solicitudes abiertas/ })).toHaveAttribute('href', '/tickets?view=created&status=OPEN');
    expect(within(stats).getByText('7')).toBeInTheDocument();

    const pending = await screen.findByRole('table', { name: 'Pendientes' });
    const rows = within(pending).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByRole('link', { name: 'Confirmación de pago' })).toHaveAttribute('href', `/tickets/${id(1)}`);
    expect(within(rows[0]!).getByText('Vencido')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Sin plazo')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Pausado')).toBeInTheDocument();
  });

  it('says when nothing is pending, and hides the new ticket button from someone who cannot create', async () => {
    renderRoute('/', { handlers: { '/auth/me/permissions': () => ({ permissions: [{ action: 'read_assigned', subject: 'Ticket', conditional: false }] }) } });

    expect(await screen.findByText('No tienes tickets pendientes.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo ticket' })).toBeNull();
  });
});
