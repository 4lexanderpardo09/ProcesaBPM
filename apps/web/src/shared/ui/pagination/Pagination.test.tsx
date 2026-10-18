import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('says which items it shows and moves between pages', async () => {
    const onChange = vi.fn();
    render(<Pagination page={2} pageSize={25} total={80} onChange={onChange} />);
    expect(screen.getByRole('navigation', { name: 'Paginación' })).toHaveTextContent('Mostrando 26–50 de 80');
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onChange.mock.calls).toEqual([[1], [3]]);
  });

  it('disables what leads nowhere', () => {
    render(<Pagination page={1} pageSize={25} total={30} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  it('hides the buttons when everything fits in one page', () => {
    render(<Pagination page={1} pageSize={25} total={8} onChange={vi.fn()} />);
    expect(screen.getByText('Mostrando 1–8 de 8')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
