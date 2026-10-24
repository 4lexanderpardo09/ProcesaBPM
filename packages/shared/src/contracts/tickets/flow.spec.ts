import { describe, expect, it } from 'vitest';
import { ticketFlowResponseSchema } from './flow.js';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;

const flow = {
  ticketId: id(1),
  versionId: id(2),
  status: 'OPEN',
  currentStepId: id(4),
  steps: [
    { id: id(3), type: 'START', name: 'Inicio', position: { x: 0, y: 0 }, passCount: 1 },
    { id: id(4), type: 'TASK', name: 'Revisión', position: { x: 240, y: 0 }, passCount: 2 },
    { id: id(5), type: 'END', name: 'Fin', position: { x: 480, y: 0 }, passCount: 0 },
  ],
  transitions: [
    { id: id(6), fromStepId: id(3), toStepId: id(4), type: 'DEFAULT', label: 'Siguiente', points: null, takenCount: 1 },
    { id: id(7), fromStepId: id(4), toStepId: id(4), type: 'DECISION', label: 'Devolver', points: [{ x: 300, y: -80 }], takenCount: 1 },
    { id: id(8), fromStepId: id(4), toStepId: id(5), type: 'DECISION', label: 'Aprobar', points: null, takenCount: 0 },
  ],
  visits: [
    { stepId: id(4), loop: 1, enteredAt: '2026-10-01T13:00:00.000Z', exitedAt: '2026-10-02T13:00:00.000Z', dueAt: '2026-10-01T21:00:00.000Z', result: 'LATE' },
    { stepId: id(4), loop: 2, enteredAt: '2026-10-02T13:00:00.000Z', exitedAt: null, dueAt: null, result: null },
  ],
};

describe('ticketFlowResponseSchema', () => {
  it('accepts the graph of a version with the progress of the ticket', () => {
    expect(ticketFlowResponseSchema.parse(flow).steps[1]?.passCount).toBe(2);
  });

  it('accepts a closed ticket without a current step', () => {
    expect(ticketFlowResponseSchema.parse({ ...flow, status: 'CLOSED', currentStepId: null }).currentStepId).toBeNull();
  });

  it('rejects a block type the builder does not have and a negative count', () => {
    expect(ticketFlowResponseSchema.safeParse({ ...flow, steps: [{ ...flow.steps[0], type: 'LOOP' }] }).success).toBe(false);
    expect(ticketFlowResponseSchema.safeParse({ ...flow, transitions: [{ ...flow.transitions[0], takenCount: -1 }] }).success).toBe(false);
  });
});
