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
});
