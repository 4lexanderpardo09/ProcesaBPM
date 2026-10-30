import { emptyCanvasDesign } from '@procesabpm/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { designed, finishedJob, formatAi, formatJob } from './format-ai-fixtures';
import { FormatAiPanel } from './FormatAiPanel';

describe('FormatAiPanel', () => {
  it('greets on first use and asks for a new format when the canvas is empty', async () => {
    const mutate = vi.fn();
    render(<FormatAiPanel ai={formatAi([], mutate)} design={{ ...emptyCanvasDesign(), elements: [] }} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Hola, soy Jiro/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Descripción del documento' }), 'Un comprobante de pago con el total y la firma del cliente.');
    await userEvent.click(screen.getByRole('button', { name: 'Diseñar formato' }));
    expect(mutate).toHaveBeenCalledWith({ mode: 'CREATE', description: 'Un comprobante de pago con el total y la firma del cliente.' }, expect.anything());
  });

  it('asks for a change to the design on screen, sending it along, and warns before starting over', async () => {
    const mutate = vi.fn();
    const onScreen = emptyCanvasDesign();
    render(<FormatAiPanel ai={formatAi([], mutate)} design={onScreen} onApply={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Cambio al formato' }), 'Agrega el NIT');
    await userEvent.click(screen.getByRole('button', { name: 'Pedir el cambio' }));
    expect(mutate).toHaveBeenCalledWith({ mode: 'REVISE', description: 'Agrega el NIT', design: onScreen }, expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Empezar de cero' }));
    expect(screen.getByText(/reemplaza lo que hay en el lienzo/)).toBeInTheDocument();
  });

  it('shows the run live, holds the next message, and lets a finished design be put back on the canvas', async () => {
    const onApply = vi.fn();
    const { rerender } = render(<FormatAiPanel ai={formatAi([formatJob({})])} design={designed} onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByText('Dibujando el formato')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir el cambio' })).toBeDisabled();

    rerender(<FormatAiPanel ai={formatAi([finishedJob])} design={designed} onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByText(/Listo: lo puse en el lienzo/)).toBeInTheDocument();
    expect(screen.getByText('Dos firmas abajo: quien entrega y quien recibe.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Volver a poner este formato' }));
    expect(onApply).toHaveBeenCalledWith(finishedJob.result);
  });

  it('explains a failed request in terms of formats', () => {
    render(<FormatAiPanel ai={formatAi([formatJob({ status: 'FAILED', errorCode: 'FORMAT_GONE', completedAt: '2026-10-30T15:00:30Z' })])} design={designed} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('El formato ya no existe.')).toBeInTheDocument();
  });
});
