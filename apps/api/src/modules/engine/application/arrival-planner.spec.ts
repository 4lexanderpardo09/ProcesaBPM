import type { RouteHop, StepDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type Arrival, arrivalEvents, computedEvents, hopEvents, slaTermsOf } from './arrival-planner.js';
import { diversionEdge } from './submission-validator.js';

const step = (overrides: Partial<StepDocument> = {}) => ({ id: 's', slaValue: 8, slaUnit: 'BUSINESS_HOURS', slaOverrides: [], ...overrides }) as unknown as StepDocument;

const NO_COMPUTED = { fieldWrites: [], changes: [], failures: [], stepId: undefined } as const;

describe('slaTermsOf', () => {
  it('uses the SLA of the step', () => expect(slaTermsOf(step(), 'c1')).toEqual({ value: 8, unit: 'BUSINESS_HOURS' }));
  it('prefers the override of the ticket company', () => {
    const withOverride = step({ slaOverrides: [{ companyId: 'c2', slaValue: 2, slaUnit: 'BUSINESS_DAYS' }] });
    expect(slaTermsOf(withOverride, 'c2')).toEqual({ value: 2, unit: 'BUSINESS_DAYS' });
    expect(slaTermsOf(withOverride, 'c1')).toEqual({ value: 8, unit: 'BUSINESS_HOURS' });
  });
  it('a step without SLA has none', () => expect(slaTermsOf(step({ slaValue: null, slaUnit: null }), 'c1')).toEqual({ value: null, unit: null }));
});

describe('events of an arrival', () => {
  const hops: RouteHop[] = [
    { stepId: 'cond', blockType: 'CONDITION', transitionId: 't1', toStepId: 'mail' },
    { stepId: 'mail', blockType: 'NOTIFICATION', transitionId: 't2', toStepId: 'task' },
  ];

  it('records each automatic block as an actorless TRANSITIONED, with outbox work only for side-effect blocks', () => {
    const [condition, notification] = hopEvents(hops, 3);
    expect(condition).toMatchObject({ type: 'TRANSITIONED', stepId: 'cond', transitionId: 't1', loop: 3, actorId: null, data: { automatic: true, blockType: 'CONDITION' } });
    expect(condition!.outbox).toBeUndefined();
    expect(notification!.outbox).toEqual([{ type: 'block.notification', payload: { stepId: 'mail' } }]);
  });

  it('adds one ASSIGNED per assignee when the ticket arrives at a people step', () => {
    const arrival: Arrival = {
      kind: 'PEOPLE',
      hops,
      step: step({ id: 'task' }),
      assigneeType: 'POOL',
      computed: NO_COMPUTED,
      plan: { visit: { stepId: 'task', loop: 2, enteredAt: new Date(), sla: { value: null, unit: null }, calendarId: null, dueAt: null }, clocks: [], assignees: [{ userId: 'a', type: 'POOL' }, { userId: 'b', type: 'POOL' }], parallelTasks: [] },
    };
    const events = arrivalEvents(arrival, 'actor', 1);
    expect(events.map((event) => event.type)).toEqual(['TRANSITIONED', 'TRANSITIONED', 'ASSIGNED', 'ASSIGNED']);
    expect(events[2]).toMatchObject({ stepId: 'task', loop: 2, actorId: 'actor', assigneeId: 'a', data: { assigneeType: 'POOL' }, outbox: [{ type: 'ticket.assigned' }] });
  });

  it('reaching the end only records the blocks passed', () => expect(arrivalEvents({ kind: 'END', hops, endStepId: 'end', computed: NO_COMPUTED }, 'actor', 1)).toHaveLength(2));
});

describe('computedEvents', () => {
  it('records what the CALCULATOR blocks set and what failed, without actor', () => {
    const events = computedEvents({ fieldWrites: [], changes: [{ code: 'ALLOWANCE', before: null, after: 15000 }], failures: [{ fieldCode: 'DOUBLE', reason: 'DIVISION_BY_ZERO', strict: false }], stepId: 'calc' }, 2);
    expect(events).toEqual([
      { type: 'FIELDS_UPDATED', stepId: 'calc', loop: 2, actorId: null, data: { changes: [{ code: 'ALLOWANCE', before: null, after: 15000 }], source: 'SYSTEM' } },
      { type: 'SYSTEM', stepId: 'calc', loop: 2, actorId: null, data: { kind: 'FORMULA_ERROR', fieldCode: 'DOUBLE', reason: 'DIVISION_BY_ZERO' } },
    ]);
  });

  it('records nothing when no CALCULATOR block ran', () => expect(computedEvents(NO_COMPUTED, 1)).toEqual([]));
});

describe('diversionEdge', () => {
  const document = {
    steps: [],
    fields: [],
    amountRules: [],
    transitions: [
      { id: 'sys', type: 'SYSTEM_ONLY', fromStepId: 'task', toStepId: 'extra' },
      { id: 'other', type: 'SYSTEM_ONLY', fromStepId: 'elsewhere', toStepId: 'extra' },
      { id: 'plain', type: 'DECISION', fromStepId: 'task', toStepId: 'extra' },
    ],
  } as never;
  const diverting = { blocks: [], warnings: [], diversion: { id: 'rule', approvalStepId: 'extra' } } as never;

  it('is the SYSTEM_ONLY edge from the submitted step to the approval step', () => expect(diversionEdge(document, diverting, 'task')).toEqual({ transitionId: 'sys', toStepId: 'extra', ruleId: 'rule' }));
  it('does not exist when the rule does not divert or no such edge leaves the step', () => {
    expect(diversionEdge(document, { blocks: [], warnings: [], diversion: undefined } as never, 'task')).toBeUndefined();
    expect(diversionEdge(document, diverting, 'nowhere')).toBeUndefined();
  });
});
