import type { TicketFlowResponse } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { flowDiagram, retryLoopPath } from './flow-diagram';

const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const [START, REVIEW, FIX, END] = [id(1), id(2), id(3), id(4)];

const flow = (overrides: Partial<TicketFlowResponse> = {}): TicketFlowResponse => ({
  ticketId: id(10),
  versionId: id(11),
  status: 'OPEN',
  currentStepId: REVIEW,
  steps: [
    { id: START, type: 'START', name: 'Inicio', position: { x: 0, y: 0 }, passCount: 1 },
    { id: REVIEW, type: 'TASK', name: 'Revisión', position: { x: 200, y: 0 }, passCount: 2 },
    { id: FIX, type: 'TASK', name: 'Corrección', position: { x: 400, y: 100 }, passCount: 1 },
    { id: END, type: 'END', name: 'Fin', position: { x: 400, y: 0 }, passCount: 0 },
  ],
  transitions: [
    { id: id(20), fromStepId: START, toStepId: REVIEW, type: 'DEFAULT', label: '', points: null, takenCount: 1 },
    { id: id(21), fromStepId: REVIEW, toStepId: FIX, type: 'DECISION', label: 'Corregir', points: null, takenCount: 1 },
    { id: id(22), fromStepId: FIX, toStepId: REVIEW, type: 'DECISION', label: 'Reintentar', points: [{ x: 300, y: 150 }], takenCount: 1 },
    { id: id(23), fromStepId: REVIEW, toStepId: END, type: 'DECISION', label: 'Aprobar', points: null, takenCount: 0 },
  ],
  visits: [],
  ...overrides,
});

describe('flowDiagram', () => {
  it('marks the blocks the ticket went through, the one it is on and the ones ahead', () => {
    const states = flowDiagram(flow()).steps.map((step) => [step.name, step.state]);
    expect(states).toEqual([
      ['Inicio', 'done'],
      ['Revisión', 'current'],
      ['Corrección', 'done'],
      ['Fin', 'pending'],
    ]);
  });

  it('marks the way out of the current block, even one already taken', () => {
    const states = flowDiagram(flow()).transitions.map((transition) => [transition.label, transition.state]);
    expect(states).toEqual([
      ['', 'taken'],
      ['Corregir', 'next'],
      ['Reintentar', 'taken'],
      ['Aprobar', 'next'],
    ]);
  });

  it('has no current block once the ticket is closed', () => {
    const diagram = flowDiagram(flow({ status: 'CLOSED', currentStepId: END }));
    expect(diagram.steps.some((step) => step.state === 'current')).toBe(false);
    expect(diagram.transitions.some((transition) => transition.state === 'next')).toBe(false);
  });

  it('tells a retry (back to a block drawn further left) and keeps its bend points', () => {
    const retry = flowDiagram(flow()).transitions.find((transition) => transition.label === 'Reintentar');
    expect(retry).toMatchObject({ retry: true, points: [{ x: 300, y: 150 }] });
    expect(flowDiagram(flow()).transitions.filter((transition) => transition.retry)).toHaveLength(1);
  });
});

describe('retryLoopPath', () => {
  it('loops under both ends and puts the label at the bottom, halfway', () => {
    const [path, labelX, labelY] = retryLoopPath({ x: 500, y: 120 }, { x: 260, y: 100 });
    expect(path).toBe('M500,120 C548,120 548,184 380,184 C212,184 212,100 260,100');
    expect([labelX, labelY]).toEqual([380, 184]);
  });
});
