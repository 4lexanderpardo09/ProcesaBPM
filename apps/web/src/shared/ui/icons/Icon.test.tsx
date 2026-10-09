import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchIcon } from './icons';

describe('icons', () => {
  it('are hidden from assistive technology by default', () => {
    const { container } = render(<SearchIcon />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('are exposed as an image when labelled', () => {
    render(<SearchIcon aria-label="Buscar" />);
    expect(screen.getByRole('img', { name: 'Buscar' })).toBeInTheDocument();
  });

  it('use the requested size', () => {
    const { container } = render(<SearchIcon size={18} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '18');
  });
});
