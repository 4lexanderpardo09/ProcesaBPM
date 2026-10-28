import { describe, expect, it } from 'vitest';
import type { StepDocument, WorkflowVersionDocument } from '../document.js';
import { carryOverSettings } from './carry-over.js';
import { compareDocuments } from './document-diff.js';
import type { WorkflowDraftSpec } from './spec.js';
import { advanceSpec, basisOf, stored, translated, travelAdvanceSpec } from './test-fixtures.js';

const editStep = (doc: WorkflowVersionDocument, name: string, change: Partial<StepDocument>): WorkflowVersionDocument => ({ ...doc, steps: doc.steps.map((step) => (step.name === name ? { ...step, ...change } : step)) });

/** An advance request someone tuned in the builder beyond what the spec says. */
function tunedDraft(): WorkflowVersionDocument {
  const doc = editStep(editStep(stored(translated(advanceSpec())), 'Pago del anticipo', { closeRule: 'ALLOWED', files: [{ fileId: 'file-1', label: 'Formato', sortOrder: 0 }] }), 'Revisión contable', {
    description: '<p>Revisa <strong>todo</strong></p>',
  });
  return { ...doc, fields: doc.fields.map((field) => (field.code === 'MOTIVO' ? { ...field, isReadOnly: true } : field)) };
}

const names = (losses: readonly { name: string }[]) => losses.map((loss) => loss.name).sort();

describe('carryOverSettings', () => {
  it.each([
    ['a tuned advance request', tunedDraft],
    ['a signature block, initiators and amount rules with settings of their own', () => {
      const doc = stored(translated(travelAdvanceSpec()));
      return {
        ...doc,
        transitions: doc.transitions.map((transition) => (transition.label === 'Firmar' ? { ...transition, type: 'SYSTEM_ONLY' as const } : transition)),
        amountRules: doc.amountRules.map((rule) => ({ ...rule, companyId: 'company-1' })),
      };
    }],
  ])('gives back the very draft when the model changes nothing: %s', (_name, build) => {
    const original = build();
    const basis = basisOf(original);
    expect(basis.hidden).not.toHaveLength(0);
    const carried = carryOverSettings(basis, basis.spec, translated(basis.spec));
    expect(compareDocuments(original, carried.document, basis.refs)).toEqual([]);
    expect(carried.kept).toHaveLength(basis.hidden.length);
    expect(carried.dropped).toEqual([]);
  });

  it('keeps the settings of what the model left alone and drops those of what it changed or removed', () => {
    const basis = basisOf(tunedDraft());
    const after: WorkflowDraftSpec = {
      ...basis.spec,
      steps: basis.spec.steps.map((step) => (step.name === 'Revisión contable' ? { ...step, instructions: 'Revisa los soportes y el monto.' } : step)),
      fields: basis.spec.fields.filter((field) => field.code !== 'MOTIVO'),
    };
    const carried = carryOverSettings(basis, after, translated(after));

    expect(names(carried.kept)).toEqual(['Pago del anticipo']);
    expect(names(carried.dropped)).toEqual(['MOTIVO', 'Revisión contable']);
    const payment = carried.document.steps.find((step) => step.name === 'Pago del anticipo')!;
    expect(payment).toMatchObject({ id: 'new:pago_del_anticipo', closeRule: 'ALLOWED', files: [{ fileId: 'file-1' }] });
    expect(carried.document.steps.find((step) => step.name === 'Revisión contable')?.description).toBe('<p>Revisa los soportes y el monto.</p>');
  });

  it('keeps an untouched step whose neighbours the model added or renamed, with the ids and place of the revision', () => {
    const basis = basisOf(tunedDraft());
    const after: WorkflowDraftSpec = { ...basis.spec, steps: basis.spec.steps.map((step) => (step.ref === 'aprobacion_de_gerencia' ? { ...step, name: 'Visto bueno de gerencia' } : step)) };
    const revised = translated(after);
    const carried = carryOverSettings(basis, after, revised);
    const payment = carried.document.steps.find((step) => step.name === 'Pago del anticipo')!;
    expect(payment.ui).toEqual(revised.steps.find((step) => step.id === payment.id)?.ui);
    expect(carried.document.steps.map((step) => step.id).sort()).toEqual(revised.steps.map((step) => step.id).sort());
    expect(names(carried.kept)).toEqual(['MOTIVO', 'Pago del anticipo', 'Revisión contable']);
  });

  it('drops a kept setting that would add an error neither draft had (a deadline on a field the model removed)', () => {
    const original = editStep(tunedDraft(), 'Pago del anticipo', { deadlineType: 'CUTOFF', deadlineFieldCode: 'DESTINO', deadlineBusinessDays: 2 });
    const basis = basisOf(original);
    const after: WorkflowDraftSpec = { ...basis.spec, fields: basis.spec.fields.filter((field) => field.code !== 'DESTINO') };
    const carried = carryOverSettings(basis, after, translated(after));
    expect(names(carried.dropped)).toEqual(['Pago del anticipo']);
    expect(carried.document.steps.find((step) => step.name === 'Pago del anticipo')).toMatchObject({ deadlineFieldCode: null, closeRule: 'NOT_ALLOWED', files: [] });
    expect(names(carried.kept)).toEqual(['MOTIVO', 'Revisión contable']);
  });

  it('keeps a setting that comes with an error the original draft already had', () => {
    const original = editStep(tunedDraft(), 'Pago del anticipo', { config: { batch: { maxTickets: -5 } }, allowsBatch: true });
    const basis = basisOf(original);
    const carried = carryOverSettings(basis, basis.spec, translated(basis.spec));
    expect(carried.dropped).toEqual([]);
    expect(carried.document.steps.find((step) => step.name === 'Pago del anticipo')).toMatchObject({ allowsBatch: true, config: { batch: { maxTickets: -5 } } });
  });

  it('pairs amount rules by their order: the translation keeps the order of the spec', () => {
    const spec = travelAdvanceSpec();
    const [rule] = spec.amountRules;
    const twoRules: WorkflowDraftSpec = { ...spec, amountRules: [{ ...rule!, maxAmount: 9_000_000, message: 'Segunda' }, rule!] };
    expect(translated(twoRules).amountRules.map((candidate) => [Number(candidate.maxAmount), candidate.message])).toEqual(twoRules.amountRules.map((candidate) => [candidate.maxAmount, candidate.message]));

    const original = stored(translated(twoRules));
    const tuned = { ...original, amountRules: original.amountRules.map((candidate, at) => (at === 1 ? { ...candidate, companyId: 'company-1' } : candidate)) };
    const basis = basisOf(tuned);
    const carried = carryOverSettings(basis, basis.spec, translated(basis.spec));
    expect(carried.document.amountRules.map((candidate) => [Number(candidate.maxAmount), candidate.companyId])).toEqual([
      [9_000_000, null],
      [5_000_000, 'company-1'],
    ]);
  });
});
