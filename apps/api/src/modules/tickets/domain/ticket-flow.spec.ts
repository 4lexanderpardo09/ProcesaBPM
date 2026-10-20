import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type TicketProgress, ticketFlowOf } from './ticket-flow.js';

const step = (id: string, type: string, x = 0) => ({
  id,
  type,
  name: `Step ${id}`,
  description: 'internal notes',
  assignmentMode: 'USERS',
  candidates: [{ id: `${id}-c`, participantType: 'USER', userId: 'someone', positionId: null, groupId: null }],
  config: { url: 'https://hooks.example.com/secret', headers: { authorization: 'Bearer secret' } },
  ui: { x, y: 10 },
});
const transition = (id: string, from: string, to: string, type: string, uiPoints: Array<{ x: number; y: number }> | null = null) => ({
  id,
  fromStepId: from,
  toStepId: to,
  type,
  label: `Go ${id}`,
  condition: type === 'CONDITION' ? { fieldCode: 'AMOUNT', operator: 'gt', value: 100 } : null,
  sortOrder: 0,
  uiPoints,
});

/** START → hook (WEBHOOK) → review (TASK) ⟲ "back" → END; review → END by "approve". */
const document = {
  steps: [step('start', 'START'), step('hook', 'WEBHOOK', 100), step('review', 'TASK', 200), step('end', 'END', 300)],
  transitions: [
    transition('t-start', 'start', 'hook', 'DEFAULT'),
    transition('t-hook', 'hook', 'review', 'DEFAULT'),
    transition('t-back', 'review', 'review', 'DECISION', [{ x: 200, y: -50 }]),
    transition('t-approve', 'review', 'end', 'DECISION'),
  ],
  fields: [{ id: 'f', stepId: 'start', code: 'AMOUNT', config: { min: 0 } }],
  amountRules: [{ id: 'r', fieldCode: 'AMOUNT', maxAmount: '10.00' }],
} as unknown as WorkflowVersionDocument;

const progress = (overrides: Partial<TicketProgress> = {}): TicketProgress => ({
  ticketId: 'ticket',
  versionId: 'version',
  status: 'OPEN',
  currentStepId: 'review',
  visitedStepIds: ['review'],
  takenTransitionIds: ['t-start', 't-hook'],
  ...overrides,
});

const passes = (flow: ReturnType<typeof ticketFlowOf>) => Object.fromEntries(flow.steps.map((entry) => [entry.id, entry.passCount]));
const taken = (flow: ReturnType<typeof ticketFlowOf>) => Object.fromEntries(flow.transitions.map((entry) => [entry.id, entry.takenCount]));

describe('ticketFlowOf', () => {
  it('draws every block and transition of the version with its position and bend points', () => {
    const flow = ticketFlowOf(document, progress());
    expect(flow.steps[2]).toEqual({ id: 'review', type: 'TASK', name: 'Step review', position: { x: 200, y: 10 }, passCount: 1 });
    expect(flow.transitions[2]).toEqual({ id: 't-back', fromStepId: 'review', toStepId: 'review', type: 'DECISION', label: 'Go t-back', points: [{ x: 200, y: -50 }], takenCount: 0 });
    expect(flow.transitions[0]?.points).toBeNull();
    expect(flow).toMatchObject({ ticketId: 'ticket', versionId: 'version', status: 'OPEN', currentStepId: 'review' });
  });

  it('exposes nothing of the version but the diagram: no configuration, rules, conditions, candidates or fields', () => {
    const flow = ticketFlowOf(document, progress());
    expect(Object.keys(flow).sort()).toEqual(['currentStepId', 'status', 'steps', 'ticketId', 'transitions', 'versionId']);
    for (const entry of flow.steps) expect(Object.keys(entry).sort()).toEqual(['id', 'name', 'passCount', 'position', 'type']);
    for (const entry of flow.transitions) expect(Object.keys(entry).sort()).toEqual(['fromStepId', 'id', 'label', 'points', 'takenCount', 'toStepId', 'type']);
    expect(JSON.stringify(flow)).not.toMatch(/secret|hooks\.example|AMOUNT|internal notes|someone/);
  });

  it('counts the automatic blocks passed (they have no visits) and leaves the unreached ones at zero', () => {
    const flow = ticketFlowOf(document, progress());
    expect(passes(flow)).toEqual({ start: 1, hook: 1, review: 1, end: 0 });
    expect(taken(flow)).toEqual({ 't-start': 1, 't-hook': 1, 't-back': 0, 't-approve': 0 });
  });

  it('a loop counts the step and the transition again', () => {
    const flow = ticketFlowOf(document, progress({ visitedStepIds: ['review', 'review', 'review'], takenTransitionIds: ['t-start', 't-hook', 't-back', 't-back'] }));
    expect(passes(flow).review).toBe(3);
    expect(taken(flow)['t-back']).toBe(2);
  });

  it('a closed ticket has no current step and its END counts as reached', () => {
    const flow = ticketFlowOf(document, progress({ status: 'CLOSED', currentStepId: 'end', takenTransitionIds: ['t-start', 't-hook', 't-approve'] }));
    expect(flow.currentStepId).toBeNull();
    expect(passes(flow).end).toBe(1);
  });

  it('a reopening (a visit without a transition into the step) still counts the pass', () => {
    const flow = ticketFlowOf(document, progress({ visitedStepIds: ['review', 'review'], takenTransitionIds: ['t-start', 't-hook', 't-approve'] }));
    expect(passes(flow)).toMatchObject({ review: 2, end: 1 });
  });

  it('a paused ticket keeps its current step', () => {
    expect(ticketFlowOf(document, progress({ status: 'PAUSED' })).currentStepId).toBe('review');
  });

  it('ignores a transition id that is not of the version', () => {
    expect(passes(ticketFlowOf(document, progress({ takenTransitionIds: ['t-start', 'elsewhere'] })))).toEqual({ start: 1, hook: 1, review: 1, end: 0 });
  });
});
