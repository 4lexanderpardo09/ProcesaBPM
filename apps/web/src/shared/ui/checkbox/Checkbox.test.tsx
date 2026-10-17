import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is checked by clicking its label', async () => {
    render(<Checkbox label="Guardé los códigos en un lugar seguro" />);
    await userEvent.click(screen.getByText('Guardé los códigos en un lugar seguro'));
    expect(screen.getByRole('checkbox', { name: 'Guardé los códigos en un lugar seguro' })).toBeChecked();
  });
});
