import { type StepDocument, type WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { layeredPositions, peopleOf, stepBadges } from './canvas-extras';

const step = (id: string, type: StepDocument['type'], extra: Partial<StepDocument> = {}) =>
  ({ id, type, name: id, config: {}, allowsBatch: false, deadlineType: 'SLA', files: [], ui: { x: 0, y: 0 }, ...extra }) as StepDocument;
const link = (from: string, to: string) => ({ id: `${from}-${to}`, fromStepId: from, toStepId: to, type: 'DECISION', label: to, condition: null, sortOrder: 0 });
const rule = (stepId: string, action: 'BLOCK' | 'WARN' | 'EXTRA_APPROVAL', isActive = true) => ({ id: `${stepId}-${action}`, stepId, action, isActive });
const doc = (steps: StepDocument[], transitions: ReturnType<typeof link>[] = [], amountRules: ReturnType<typeof rule>[] = []) => ({ steps, transitions, fields: [], amountRules }) as unknown as WorkflowVersionDocument;

describe('stepBadges', () => {
  it('lists the active caps with the strongest action, cutoff, export, batch and files', () => {
    const task = step('task', 'TASK', { deadlineType: 'CUTOFF', allowsBatch: true, config: { requiredExportId: 'x' }, files: [{}, {}] as unknown as StepDocument['files'] });
    expect(stepBadges(doc([task], [], [rule('task', 'WARN'), rule('task', 'BLOCK'), rule('task', 'EXTRA_APPROVAL', false), rule('other', 'BLOCK')]), task)).toEqual([
      { kind: 'amountRules', count: 2, strongest: 'BLOCK' },
      { kind: 'cutoff' },
      { kind: 'export' },
      { kind: 'batch' },
      { kind: 'files', count: 2 },
    ]);
    expect(stepBadges(doc([step('plain', 'TASK')]), step('plain', 'TASK'))).toEqual([]);
  });
});

describe('layeredPositions', () => {
  it('puts each block right of the ones leading to it, survives loops, and places every block', () => {
    const steps = [step('start', 'START'), step('a', 'TASK'), step('b', 'TASK'), step('end', 'END'), step('lost', 'TASK')];
    const positions = layeredPositions(doc(steps, [link('start', 'a'), link('a', 'b'), link('b', 'a'), link('a', 'end'), link('b', 'end'), link('start', 'end')]));
    const x = (id: string) => positions.get(id)?.x ?? Number.NaN;
    expect(x('start')).toBeLessThan(x('a'));
    expect(x('a')).toBeLessThan(x('b'));
    expect(x('b')).toBeLessThan(x('end'));
    expect([...positions.keys()].sort()).toEqual(['a', 'b', 'end', 'lost', 'start']);
  });
});

describe('peopleOf', () => {
  it('groups the start’s creators by kind in a fixed order and leaves out names not known', () => {
    const initiator = (participantType: string, id: string) => ({ id: `i-${id}`, participantType, userId: participantType === 'USER' ? id : null, positionId: participantType === 'POSITION' ? id : null, groupId: null, departmentId: participantType === 'DEPARTMENT' ? id : null, companyId: null, siteId: null });
    const start = step('start', 'START', { initiators: [initiator('POSITION', 'p1'), initiator('DEPARTMENT', 'd1'), initiator('DEPARTMENT', 'd2'), initiator('USER', 'u1')] as unknown as StepDocument['initiators'] });
    const names: Record<string, string> = { p1: 'Cajero', d1: 'Cartera', d2: 'Tesorería' };
    expect(peopleOf(start, (id) => names[id])).toEqual([
      { kind: 'DEPARTMENT', names: ['Cartera', 'Tesorería'] },
      { kind: 'POSITION', names: ['Cajero'] },
    ]);
  });
});
