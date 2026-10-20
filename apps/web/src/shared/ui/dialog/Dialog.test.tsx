import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

const renderDialog = (open: boolean, handlers: { onClose?: () => void; onSubmit?: () => void } = {}) =>
  render(
    <Dialog open={open} title="Reasignar ticket" closeLabel="Cerrar" onClose={handlers.onClose ?? vi.fn()} {...(handlers.onSubmit === undefined ? {} : { onSubmit: (event) => { event.preventDefault(); handlers.onSubmit?.(); } })} footer={<button type="submit">Reasignar</button>}>
      <p>¿A quién?</p>
    </Dialog>,
  );

describe('Dialog', () => {
  it('shows nothing while closed', () => {
    renderDialog(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal named by its title', () => {
    renderDialog(true);
    expect(screen.getByRole('dialog', { name: 'Reasignar ticket' })).toHaveTextContent('¿A quién?');
  });

  it('asks the parent to close it from its close button', async () => {
    const onClose = vi.fn();
    renderDialog(true, { onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('submits its form from a button in the footer', async () => {
    const onSubmit = vi.fn();
    renderDialog(true, { onSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Reasignar' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
