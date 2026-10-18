import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TextArea } from './TextArea';

describe('TextArea', () => {
  it('is labelled by its label and takes several lines', async () => {
    render(<TextArea label="Comentario" />);
    const textArea = screen.getByRole('textbox', { name: 'Comentario' });
    await userEvent.type(textArea, 'Primera línea{enter}segunda');
    expect(textArea).toHaveValue('Primera línea\nsegunda');
  });

  it('marks itself invalid and describes the error', () => {
    render(<TextArea label="Comentario" error="Escribe un comentario" />);
    const textArea = screen.getByLabelText('Comentario');
    expect(textArea).toHaveAttribute('aria-invalid', 'true');
    expect(textArea).toHaveAccessibleDescription('Escribe un comentario');
  });
});
