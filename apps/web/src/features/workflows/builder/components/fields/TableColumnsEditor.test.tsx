import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type TableColumn, TableColumnsEditor } from './TableColumnsEditor';

function Editor({ initial, onChange }: { readonly initial: TableColumn[]; readonly onChange: (columns: TableColumn[]) => void }) {
  const [columns, setColumns] = useState(initial);
  return (
    <TableColumnsEditor
      columns={columns}
      onChange={(next) => {
        setColumns(next);
        onChange(next);
      }}
    />
  );
}

describe('TableColumnsEditor', () => {
  it('turns a column into a formula of the other columns, without the required flag, and back', async () => {
    const onChange = vi.fn();
    render(<Editor initial={[{ code: 'QTY', label: 'Cantidad', type: 'NUMBER' }, { code: 'SUB', label: 'Subtotal', type: 'NUMBER', required: true }]} onChange={onChange} />);

    await userEvent.selectOptions(screen.getAllByRole('combobox', { name: 'Tipo' })[1]!, 'Fórmula');
    const expression = screen.getByRole('textbox', { name: 'Fórmula de la columna' });
    expect(expression).toHaveAccessibleDescription(/QTY/);
    await userEvent.type(expression, 'QTY * 2');
    expect(onChange).toHaveBeenLastCalledWith([{ code: 'QTY', label: 'Cantidad', type: 'NUMBER' }, { code: 'SUB', label: 'Subtotal', type: 'FORMULA', expression: 'QTY * 2' }]);

    await userEvent.selectOptions(screen.getAllByRole('combobox', { name: 'Tipo' })[1]!, 'Número');
    expect(onChange).toHaveBeenLastCalledWith([{ code: 'QTY', label: 'Cantidad', type: 'NUMBER' }, { code: 'SUB', label: 'Subtotal', type: 'NUMBER' }]);
  });

  it('makes a file column with files per cell and accepted kinds, and drops them when it changes type', async () => {
    const onChange = vi.fn();
    render(<Editor initial={[{ code: 'PROOF', label: 'Soporte', type: 'TEXT' }]} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'Archivo');
    const perCell = screen.getByRole('textbox', { name: 'Archivos por celda' });
    await userEvent.clear(perCell);
    await userEvent.type(perCell, '3');
    await userEvent.click(screen.getByRole('checkbox', { name: /Comprimidos|ZIP/ }));
    expect(onChange).toHaveBeenLastCalledWith([{ code: 'PROOF', label: 'Soporte', type: 'FILE', maxFiles: 3, accept: ['PDF', 'IMAGE', 'OFFICE'] }]);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'Texto');
    expect(onChange).toHaveBeenLastCalledWith([{ code: 'PROOF', label: 'Soporte', type: 'TEXT' }]);
  });
});
