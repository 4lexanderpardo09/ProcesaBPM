import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('names its section with the title', () => {
    render(<Card title="Datos de la solicitud">Contenido</Card>);
    expect(screen.getByRole('heading', { name: 'Datos de la solicitud' })).toBeInTheDocument();
    expect(screen.getByText('Contenido')).toBeInTheDocument();
  });

  it('has no header without a title', () => {
    render(<Card>Contenido</Card>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
