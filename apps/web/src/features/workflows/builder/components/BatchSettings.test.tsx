import type { FieldDocument } from '@procesabpm/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type BatchConfig, BatchSettings } from './BatchSettings';

const field = (code: string, label: string, type: string, dataSource: Record<string, unknown> | null = null) => ({ code, label, type, config: {}, dataSource }) as unknown as FieldDocument;
const fields = [field('NAME', 'Nombre', 'TEXT'), field('AMOUNT', 'Monto', 'CURRENCY'), field('RECEIPT', 'Soporte', 'FILE'), field('BOSS', 'Jefe', 'SELECT', { kind: 'PRESET' })];

function Harness({ onChange }: { readonly onChange: (batch: BatchConfig | undefined) => void }) {
  const [batch, setBatch] = useState<BatchConfig | undefined>(undefined);
  return (
    <BatchSettings
      batch={batch}
      fields={fields}
      readOnly={false}
      onChange={(next) => {
        setBatch(next);
        onChange(next);
      }}
    />
  );
}

describe('BatchSettings', () => {
  it('keeps the limit with any other setting and offers only fields whose value reads alone', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agrupar los tickets por' }), 'Sede del solicitante');
    expect(onChange).toHaveBeenLastCalledWith({ groupBy: 'REQUESTER_SITE', maxTickets: 100 });

    const first = screen.getByRole('combobox', { name: /Dato 1/ });
    expect([...first.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Ninguno', 'Nombre (NAME)', 'Monto (AMOUNT)']);
    await userEvent.selectOptions(first, 'Monto (AMOUNT)');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Dato 2/ }), 'Nombre (NAME)');
    expect(onChange).toHaveBeenLastCalledWith({ groupBy: 'REQUESTER_SITE', maxTickets: 100, showFields: ['AMOUNT', 'NAME'] });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Dato 1/ }), 'Ninguno');
    expect(onChange).toHaveBeenLastCalledWith({ groupBy: 'REQUESTER_SITE', maxTickets: 100, showFields: ['NAME'] });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agrupar los tickets por' }), 'Sin agrupar');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Dato 1/ }), 'Ninguno');
    expect(onChange).toHaveBeenLastCalledWith({ maxTickets: 100 });
  });

  it('groups by a field that reads alone, and drops it when the grouping changes', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agrupar los tickets por' }), 'Un dato del formulario');
    expect(onChange).toHaveBeenLastCalledWith({ groupBy: 'FIELD', groupFieldCode: 'NAME', maxTickets: 100 });
    const byField = screen.getByRole('combobox', { name: 'Dato por el que se agrupa' });
    expect([...byField.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Ninguno', 'Nombre (NAME)', 'Monto (AMOUNT)']);
    await userEvent.selectOptions(byField, 'Monto (AMOUNT)');
    expect(onChange).toHaveBeenLastCalledWith({ groupBy: 'FIELD', groupFieldCode: 'AMOUNT', maxTickets: 100 });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agrupar los tickets por' }), 'Empresa');
    expect(onChange).toHaveBeenLastCalledWith({ groupBy: 'COMPANY', maxTickets: 100 });
    expect(screen.queryByRole('combobox', { name: 'Dato por el que se agrupa' })).not.toBeInTheDocument();
  });
});
