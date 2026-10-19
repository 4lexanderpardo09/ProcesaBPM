import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText';

describe('RichText', () => {
  it('draws the formatted text with its links', () => {
    render(<RichText html={'<p>Revisa el <a href="https://example.com/extracto">extracto</a> del banco.</p>'} />);
    expect(screen.getByText(/Revisa el/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'extracto' })).toHaveAttribute('href', 'https://example.com/extracto');
  });
});
