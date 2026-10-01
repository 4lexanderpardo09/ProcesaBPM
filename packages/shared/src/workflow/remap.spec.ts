import { describe, expect, it } from 'vitest';
import type { WorkflowVersionDocument } from './document.js';
import { remapVersionDocument } from './remap.js';
import { amountRule, field, next, step, transition, version } from './test-builders.js';
import { validateWorkflowGraph } from './validate-workflow-graph.js';

function sample(): WorkflowVersionDocument {
  return version({
    steps: [
      step('start', 'START'),
      step('task', 'TASK', { candidates: [{ id: 'cand', participantType: 'USER', userId: 'u', positionId: null, groupId: null }], slaOverrides: [{ companyId: 'c', slaValue: 2, slaUnit: 'BUSINESS_DAYS' }], files: [{ fileId: 'file', label: 'Form', sortOrder: 1 }] }),
      step('extra', 'APPROVAL', { assignmentMode: 'APPROVER', approvalGroupTypeId: 't', approvalLevel: 1 }),
      step('end', 'END'),
    ],
    transitions: [next('start', 'task'), next('task', 'end', 'DECISION'), transition('sys', 'task', 'extra', 'SYSTEM_ONLY'), next('extra', 'end', 'DECISION')],
    fields: [field('f', 'start', 'AMOUNT', { type: 'NUMBER' })],
    amountRules: [amountRule('r', 'AMOUNT', { stepId: 'task', action: 'EXTRA_APPROVAL', approvalStepId: 'extra' })],
  });
}

describe('remapVersionDocument', () => {
  const counter = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  it('gives every row a new id and rewires every reference', () => {
    const copy = remapVersionDocument(sample(), counter());
    const stepIds = new Map(copy.steps.map((entry, index) => [sample().steps[index]!.id, entry.id]));
    expect(new Set(copy.steps.map((entry) => entry.id)).size).toBe(4);
    for (const old of ['start', 'task', 'extra', 'end']) expect(stepIds.get(old)).not.toBe(old);
    const fromTo = copy.transitions.map((entry) => [entry.fromStepId, entry.toStepId]);
    expect(fromTo).toEqual(sample().transitions.map((entry) => [stepIds.get(entry.fromStepId), stepIds.get(entry.toStepId)]));
    expect(copy.fields[0]!.stepId).toBe(stepIds.get('start'));
    expect(copy.amountRules[0]).toMatchObject({ stepId: stepIds.get('task'), approvalStepId: stepIds.get('extra') });
    expect(copy.steps[1]!.candidates[0]!.id).not.toBe('cand');
  });

  it('keeps everything else identical, and a valid version stays valid', () => {
    const original = sample();
    const copy = remapVersionDocument(original, counter());
    const strip = (doc: WorkflowVersionDocument) => JSON.stringify(doc, (key, value) => (key === 'id' || key.endsWith('StepId') || key === 'stepId' ? undefined : value));
    expect(strip(copy)).toBe(strip(original));
    expect(validateWorkflowGraph(copy)).toEqual(validateWorkflowGraph(original));
  });

  it('does not touch the original', () => {
    const original = sample();
    remapVersionDocument(original, counter());
    expect(original).toEqual(sample());
  });
});
