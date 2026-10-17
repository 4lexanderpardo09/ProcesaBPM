import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';

describe('Logo', () => {
  it('reads as the product name once', () => {
    const { container } = render(<Logo />);
    expect(container).toHaveTextContent('ProcesaBPM');
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});
