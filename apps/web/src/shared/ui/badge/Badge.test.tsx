import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('shows the status as text', () => {
    render(<Badge tone="ok">A tiempo</Badge>);
    expect(screen.getByText('A tiempo')).toHaveClass('ok');
  });

  it('keeps the dot out of the accessible name', () => {
    const { container } = render(<Badge>Cerrado</Badge>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(container.textContent).toBe('Cerrado');
  });
});
