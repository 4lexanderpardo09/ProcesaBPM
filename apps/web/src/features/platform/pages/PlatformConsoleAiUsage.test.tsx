import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { recentUsageMonths } from '../lib/usage-months';
import { id, openConsole } from './console-test-helpers';

const figures = (jobs: number, failed: number, calls: number, prompt: number, completion: number) => ({
  jobs: { total: jobs, succeeded: jobs - failed, failed },
  calls,
  promptTokens: prompt,
  cachedPromptTokens: 100,
  completionTokens: completion,
  reasoningTokens: 50,
  totalTokens: prompt + completion,
});
const row = (index: number, name: string, enabled: boolean, ...values: Parameters<typeof figures>) => ({ tenantId: id(index), slug: name.toLowerCase(), name, status: 'ACTIVE', assistantEnabled: enabled, ...figures(...values) });

describe('platform console: AI usage', () => {
  it('shows each organization’s tokens and the total, sorts them and reads another month', async () => {
    const [current, previous] = recentUsageMonths(new Date());
    const { fake } = await openConsole('/platform/ai-usage', {
      '/platform/ai-usage': () => ({
        from: current!.from,
        to: current!.to,
        // The API sends the most tokens first.
        tenants: [row(1, 'Zeta', true, 4, 1, 6, 30_000, 90_000), row(2, 'Acme', false, 9, 0, 9, 1_000, 2_000), row(3, 'Beta', true, 0, 0, 0, 0, 0)],
        totals: figures(13, 1, 15, 31_000, 92_000),
      }),
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Consumo de IA' })).toBeInTheDocument();
    expect(await screen.findByText('13 (12 terminadas, 1 fallidas)')).toBeInTheDocument();
    expect(screen.getByText('123.000')).toBeInTheDocument();
    expect(screen.getByText('31.000 (100 en caché)')).toBeInTheDocument();
    expect(fake.callsTo('/platform/ai-usage')[0]?.path).toBe(`/platform/ai-usage?from=${current!.from}&to=${current!.to}`);

    const table = screen.getByRole('table', { name: 'Por organización' });
    const names = () => within(table).getAllByRole('row').slice(1).map((line) => within(line).getAllByRole('cell')[0]?.textContent);
    expect(names()).toEqual(['Zeta', 'Acme', 'Beta']);
    expect(within(table).getByText('120.000')).toBeInTheDocument();
    expect(within(table).getByText('Apagado')).toBeInTheDocument();

    await userEvent.click(within(table).getByRole('button', { name: /Total/ }));
    expect(names()).toEqual(['Beta', 'Acme', 'Zeta']);
    await userEvent.click(within(table).getByRole('button', { name: /Solicitudes/ }));
    expect(names()).toEqual(['Acme', 'Zeta', 'Beta']);
    await userEvent.click(within(table).getByRole('button', { name: /Organización/ }));
    expect(names()).toEqual(['Acme', 'Beta', 'Zeta']);

    await userEvent.selectOptions(screen.getByLabelText('Mes'), previous!.value);
    await vi.waitFor(() => expect(fake.callsTo('/platform/ai-usage').some((call) => call.path === `/platform/ai-usage?from=${previous!.from}&to=${previous!.to}`)).toBe(true));
  });

  it('says when no organization uses the assistant', async () => {
    await openConsole('/platform/ai-usage', {
      '/platform/ai-usage': () => ({ from: '2026-10-01', to: '2026-10-31', tenants: [], totals: figures(0, 0, 0, 0, 0) }),
    });
    expect(await screen.findByText('Ninguna organización tiene el asistente encendido ni lo usó en este mes.')).toBeInTheDocument();
  });
});
