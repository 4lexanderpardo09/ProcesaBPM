import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

const priorities = [
  { value: 'high', label: 'Alta' },
  { value: 'low', label: 'Baja' },
];

describe('Select', () => {
  it('lets the person pick an option', async () => {
    render(<Select label="Prioridad" options={priorities} />);
    const select = screen.getByRole('combobox', { name: 'Prioridad' });
    await userEvent.selectOptions(select, 'Baja');
    expect(select).toHaveValue('low');
  });

  it('offers an empty placeholder option first', () => {
    render(<Select label="Prioridad" options={priorities} placeholder="Elige una prioridad" />);
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Elige una prioridad');
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('describes the error', () => {
    render(<Select label="Prioridad" options={priorities} error="Elige la prioridad" />);
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Elige la prioridad');
  });
});
