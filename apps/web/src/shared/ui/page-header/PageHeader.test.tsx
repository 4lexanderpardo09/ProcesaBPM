import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../button/Button';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('shows the page title as the main heading with its subtitle and actions', () => {
    render(<PageHeader title="Tickets" subtitle="8 tickets en la bandeja" actions={<Button variant="primary">Nuevo ticket</Button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tickets' })).toBeInTheDocument();
    expect(screen.getByText('8 tickets en la bandeja')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo ticket' })).toBeInTheDocument();
  });
});
