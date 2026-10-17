import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './Alert';

describe('Alert', () => {
  it('announces errors at once', () => {
    render(<Alert tone="danger" title="No pudimos iniciar sesión">Revisa el correo.</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos iniciar sesiónRevisa el correo.');
  });

  it.each(['warn', 'info', 'ok'] as const)('announces %s politely', (tone) => {
    render(<Alert tone={tone}>Aviso</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Aviso');
  });
});
