import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/render-route';

describe('AuthLayout', () => {
  it('shows the brand panel beside the sign-in form', async () => {
    renderRoute('/login', { signedIn: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Inicia sesión' })).toBeInTheDocument();
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByText('Tus procesos, paso a paso y a tiempo.')).toBeInTheDocument();
    expect(within(panel).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Flujos visuales con decisiones y reintentos',
      'SLA en horas o días hábiles, con tu calendario',
      'Aprobaciones con suplentes y delegaciones',
    ]);
  });

  it('keeps the sample workflow away from screen readers', async () => {
    const { container } = renderRoute('/login', { signedIn: false });
    await screen.findByRole('heading', { level: 1 });
    const illustration = container.querySelector('aside svg');
    expect(illustration).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps a single page heading', async () => {
    renderRoute('/forgot-password', { signedIn: false });
    expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
