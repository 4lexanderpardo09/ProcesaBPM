import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('is a non-submitting button by default', () => {
    render(<Button>Guardar borrador</Button>);
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toHaveAttribute('type', 'button');
  });

  it('applies the requested variant', () => {
    render(<Button variant="brand">Crear y enviar</Button>);
    expect(screen.getByRole('button')).toHaveClass('brand');
  });

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Exportar</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>Exportar</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
