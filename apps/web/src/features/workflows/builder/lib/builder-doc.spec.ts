import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { addStep, connect, type ConnectionLabels, freeSpot, moveStep, remapSelection, removeStep, toSaveRequest, uniqueName, validateDraft } from './builder-doc';

const labels: ConnectionLabels = {
  continue: 'Continuar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  otherwise: 'En otro caso',
  branch: (index) => `Rama ${String(index)}`,
  option: (index) => `Opción ${String(index)}`,
};

/** START → END, as a new workflow is born. */
function starting(): WorkflowVersionDocument {
  let doc: WorkflowVersionDocument = { steps: [], transitions: [], fields: [], amountRules: [] };
  doc = addStep(doc, 'START', 'Inicio', { x: 0, y: 0 }).doc;
  doc = addStep(doc, 'END', 'Fin', { x: 400, y: 0 }).doc;
  const linked = connect(doc, 'new:b1', 'new:b2', labels);
  if ('refusal' in linked) throw new Error('unexpected');
  return linked.doc;
}

const connected = (doc: WorkflowVersionDocument, from: string, to: string) => {
  const result = connect(doc, from, to, labels);
  if ('refusal' in result) throw new Error(result.refusal);
  return result;
};

describe('builder document', () => {
  it('a new workflow is valid: start, a default way and the end', () => {
    expect(validateDraft(starting()).errors).toEqual([]);
  });

  it('adds blocks with a unique name and the defaults of their type', () => {
    let doc = starting();
    const first = addStep(doc, 'APPROVAL', 'Aprobación', { x: 10.4, y: 20.6 });
    doc = first.doc;
    const second = addStep(doc, 'APPROVAL', 'Aprobación', { x: 0, y: 0 });
    const approval = second.doc.steps.find((step) => step.id === first.id)!;
    expect(approval).toMatchObject({ assignmentMode: 'APPROVER', approvalLevel: 1, ui: { x: 10, y: 21 } });
    expect(second.doc.steps.find((step) => step.id === second.id)!.name).toBe('Aprobación 2');
    expect(addStep(doc, 'WAIT', 'Esperar', { x: 0, y: 0 }).doc.steps.at(-1)!.config).toEqual({ mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' });
    expect(addStep(doc, 'TASK', 'Paso', { x: 0, y: 0 }).doc.steps.at(-1)!.assignmentMode).toBe('CREATOR');
  });

  it('a task inserted between start and end, and wired, keeps the flow valid', () => {
    let doc = starting();
    doc = { ...doc, transitions: [] };
    const task = addStep(doc, 'TASK', 'Revisar', { x: 200, y: 0 });
    doc = connected(task.doc, 'new:b1', task.id).doc;
    doc = connected(doc, task.id, 'new:b2').doc;
    expect(validateDraft(doc).errors).toEqual([]);
    expect(doc.transitions.map((transition) => [transition.type, transition.label])).toEqual([
      ['DEFAULT', 'Continuar'],
      ['DECISION', 'Continuar'],
    ]);
  });

  it('names the ways out of an approval approve, reject and then options', () => {
    let doc = starting();
    const approval = addStep(doc, 'APPROVAL', 'Aprobación', { x: 0, y: 0 });
    doc = approval.doc;
    const labelsDrawn: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = connected(doc, approval.id, 'new:b2');
      doc = result.doc;
      labelsDrawn.push(doc.transitions.find((transition) => transition.id === result.id)!.label);
    }
    expect(labelsDrawn).toEqual(['Aprobar', 'Rechazar', 'Opción 3']);
  });

  it('a condition gets its "otherwise" first and then rule branches', () => {
    let doc = starting();
    const condition = addStep(doc, 'CONDITION', 'Condición', { x: 0, y: 0 });
    doc = condition.doc;
    const first = connected(doc, condition.id, 'new:b2');
    const second = connected(first.doc, condition.id, 'new:b2');
    expect(second.doc.transitions.filter((transition) => transition.fromStepId === condition.id).map((transition) => [transition.type, transition.label, transition.condition])).toEqual([
      ['DEFAULT', 'En otro caso', null],
      ['CONDITION', 'Rama 1', null],
    ]);
  });

  it('refuses what the database would refuse', () => {
    const doc = starting();
    expect(connect(doc, 'new:b2', 'new:b1', labels)).toEqual({ refusal: 'fromEnd' });
    const task = addStep(doc, 'TASK', 'Paso', { x: 0, y: 0 });
    expect(connect(task.doc, task.id, 'new:b1', labels)).toEqual({ refusal: 'toStart' });
    expect(connect(doc, 'new:b1', 'new:b2', labels)).toEqual({ refusal: 'defaultTaken' });
    const wait = addStep(doc, 'WAIT', 'Esperar', { x: 0, y: 0 });
    expect(connect(wait.doc, wait.id, wait.id, labels)).toEqual({ refusal: 'toItself' });
  });

  it('removing a block takes its connections with it', () => {
    const doc = removeStep(starting(), 'new:b2');
    expect(doc.steps.map((step) => step.id)).toEqual(['new:b1']);
    expect(doc.transitions).toEqual([]);
  });

  it('moves a block to whole coordinates', () => {
    expect(moveStep(starting(), 'new:b2', { x: 10.6, y: -3.2 }).steps[1]!.ui).toEqual({ x: 11, y: -3 });
  });

  it('places a block added by a click where it covers nothing', () => {
    const doc = starting();
    expect(freeSpot(doc, { x: 20, y: 10 })).toEqual({ x: 20, y: 106 });
    expect(freeSpot(doc, { x: 1000, y: 0 })).toEqual({ x: 1000, y: 0 });
  });

  it('saves blocks and connections without what hangs off the blocks', () => {
    const request = toSaveRequest(starting(), 4);
    expect(request.revision).toBe(4);
    expect(Object.keys(request.steps[0]!)).not.toContain('candidates');
    expect(Object.keys(request.steps[0]!)).not.toContain('signers');
    expect(request.transitions).toHaveLength(1);
  });

  it('follows the selection to the id the API gave', () => {
    expect(remapSelection({ kind: 'step', id: 'new:b3' }, { 'new:b3': 'uuid-3' })).toEqual({ kind: 'step', id: 'uuid-3' });
    expect(remapSelection({ kind: 'step', id: 'uuid-1' }, { 'new:b3': 'uuid-3' })).toEqual({ kind: 'step', id: 'uuid-1' });
    expect(remapSelection(null, {})).toBeNull();
  });

  it('makes names unique without regard to case', () => {
    expect(uniqueName('Paso', ['paso', 'Paso 2'])).toBe('Paso 3');
    expect(uniqueName('Paso', ['Otro'])).toBe('Paso');
  });
});
