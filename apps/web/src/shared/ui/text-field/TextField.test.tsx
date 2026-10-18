import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('is labelled by its label', async () => {
    render(<TextField label="Asunto" />);
    const input = screen.getByLabelText('Asunto');
    await userEvent.type(input, 'Cambio de clave');
    expect(input).toHaveValue('Cambio de clave');
  });

  it('is described by its hint', () => {
    render(<TextField label="Asunto" hint="Resume la solicitud en una línea" />);
    expect(screen.getByLabelText('Asunto')).toHaveAccessibleDescription('Resume la solicitud en una línea');
  });

  it('marks itself invalid and describes the error', () => {
    render(<TextField label="Asunto" error="Escribe el asunto de la solicitud" />);
    const input = screen.getByLabelText('Asunto');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Escribe el asunto de la solicitud');
  });

  it('marks the field as required', () => {
    render(<TextField label="Asunto" required />);
    expect(screen.getByRole('textbox', { name: 'Asunto' })).toBeRequired();
  });

  it('forwards its ref to the input (react-hook-form registers through it)', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField label="Asunto" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('Asunto'));
  });
});
