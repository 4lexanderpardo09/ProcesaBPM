import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ButtonLink } from './ButtonLink';

describe('ButtonLink', () => {
  it('is a link to its destination', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/tickets/new" variant="primary">
          Nuevo ticket
        </ButtonLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Nuevo ticket' })).toHaveAttribute('href', '/tickets/new');
  });
});
