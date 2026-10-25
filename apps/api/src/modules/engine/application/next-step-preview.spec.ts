import { InvalidTransitionError, MaxLoopsReachedError, NoAssigneeCandidatesError, type StepDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { previewOrBlocked, previewResponse } from './next-step-preview.js';

const work = { id: 'work', name: 'Work', type: 'TASK' } as StepDocument;
const document = {
  steps: [{ id: 'start', name: 'Start' }, { id: 'cond', name: 'Amount' }, work],
  fields: [
    { code: 'RESULT', label: 'Result', stepId: 'work', capture: 'STEP' },
    { code: 'AT_START', label: 'At start', stepId: 'work', capture: 'CREATION' },
    { code: 'ELSEWHERE', label: 'Elsewhere', stepId: 'other', capture: 'BOTH' },
  ],
} as never;
const hops = [
  { stepId: 'start', blockType: 'START', transitionId: 't0', toStepId: 'cond' },
  { stepId: 'cond', blockType: 'CONDITION', transitionId: 't1', toStepId: 'work' },
] as const;

describe('previewResponse', () => {
  it('names the step, who gets it and the fields filled there, and the blocks passed without the START', () => {
    const response = previewResponse({ kind: 'PEOPLE', hops, step: work, assignment: 'CHOOSE', people: [{ userId: 'u1', name: 'Ana' }], signerChoices: [] }, document);
    expect(response).toEqual({
      outcome: 'STEP',
      via: [{ name: 'Amount', blockType: 'CONDITION' }],
      step: { id: 'work', name: 'Work', type: 'TASK' },
      assignment: 'CHOOSE',
      people: [{ id: 'u1', name: 'Ana' }],
      fields: ['Result'],
      resumeAt: null,
      blocked: null,
      signerChoices: [],
    });
  });

  it('a wait says until when and the end says nothing more', () => {
    const resumeAt = new Date('2026-10-24T13:00:00Z');
    expect(previewResponse({ kind: 'WAIT', hops: [], step: work, resumeAt }, document)).toMatchObject({ outcome: 'WAIT', step: { id: 'work' }, resumeAt: '2026-10-24T13:00:00.000Z', assignment: null, people: [] });
    expect(previewResponse({ kind: 'END', hops }, document)).toMatchObject({ outcome: 'END', step: null, fields: [] });
  });
});

describe('previewOrBlocked', () => {
  it('answers an error that stops the workflow as BLOCKED, with its details', async () => {
    await expect(previewOrBlocked(() => Promise.reject(new NoAssigneeCandidatesError('work', 'GROUP')))).resolves.toMatchObject({ outcome: 'BLOCKED', blocked: { code: 'NO_ASSIGNEE_CANDIDATES', details: { stepId: 'work' } } });
    await expect(previewOrBlocked(() => Promise.reject(new MaxLoopsReachedError('work', 2)))).resolves.toMatchObject({ blocked: { code: 'MAX_LOOPS_REACHED' } });
  });

  it('throws any other error as it is', async () => {
    await expect(previewOrBlocked(() => Promise.reject(new InvalidTransitionError()))).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});
