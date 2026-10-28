import { describe, expect, it } from 'vitest';
import type { StepDocument, WorkflowVersionDocument } from '../document.js';
import { plainTextOf } from './rich-text.js';
import type { WorkflowDraftSpec } from './spec.js';
import { type DraftSpecExtraction, extractDraftSpec, INCOMPLETE_PROPERTY, refsFromStepNames } from './spec-from-document.js';
import { advanceSpec, assignment, catalog, draftStep, link, stored, translated, travelAdvanceSpec } from './test-fixtures.js';

function specOf(extraction: DraftSpecExtraction): WorkflowDraftSpec {
  if (extraction.kind !== 'spec') throw new Error(`not revisable: ${JSON.stringify(extraction)}`);
  return extraction.spec;
}

/** Settings the spec does not show, without the element each one belongs to. */
function hiddenOf(document: WorkflowVersionDocument) {
  const extraction = extractDraftSpec(document, catalog);
  if (extraction.kind !== 'spec') throw new Error(`expected a spec, got ${JSON.stringify(extraction)}`);
  return extraction.basis.hidden.map(({ subject, name, properties }) => ({ subject, name, properties }));
}

function lossesOf(document: WorkflowVersionDocument) {
  const extraction = extractDraftSpec(document, catalog);
  if (extraction.kind !== 'lossy') throw new Error(`expected losses, got ${extraction.kind}`);
  return extraction.losses;
}

const parallelSpec = (): WorkflowDraftSpec => ({
  assumptions: [],
  decisions: [],
  initiators: [{ kind: 'GROUP', name: 'Mesa TI' }],
  amountRules: [],
  steps: [
    draftStep('inicio', 'START', { name: 'Inicio' }),
    draftStep('soporte', 'TASK', { name: 'Soporte', assignment: assignment({ mode: 'GROUP', group: 'Mesa TI' }) }),
    draftStep('compras', 'TASK', { name: 'Compras', assignment: assignment({ mode: 'POOL', poolPositions: ['Contador'], poolGroups: ['Mesa TI'] }) }),
    draftStep('cierre', 'TASK', { name: 'Cierre', assignment: assignment({ mode: 'SAME_AS_STEP', sameAsStep: 'soporte' }) }),
    draftStep('firmas', 'APPROVAL', {
      name: 'Firmas',
      assignment: assignment({ mode: 'PARALLEL_APPROVALS', approvalType: 'Jefatura', approvalLevel: 2, signers: [{ kind: 'POSITION', position: 'Tesorero' }, { kind: 'APPROVER', position: null }] }),
    }),
    draftStep('espera', 'WAIT', { name: 'Espera', wait: { value: 2, unit: 'BUSINESS_DAYS' } }),
    draftStep('fin', 'END', { name: 'Fin' }),
  ],
  transitions: [
    link('inicio', 'soporte', 'Enviar'),
    link('soporte', 'compras', 'Listo'),
    link('compras', 'cierre', 'Comprado'),
    link('cierre', 'firmas', 'Cerrar'),
    link('firmas', 'espera', 'Firmado'),
    link('firmas', 'cierre', 'Rechazado', { whenRejected: true }),
    link('espera', 'fin', 'Continuar'),
  ],
  fields: [],
});

describe('extractDraftSpec', () => {
  it.each([
    ['an advance request', advanceSpec],
    ['initiators, a signature block and an extra approval', travelAdvanceSpec],
    ['groups, pools, same assignee, parallel approvals and a wait', parallelSpec],
  ])('round-trips %s: translate, read back, translate again gives the same draft', (_name, build) => {
    const first = stored(translated(build()));
    const spec = specOf(extractDraftSpec(first, catalog));
    const again = translated(spec);

    expect(specOf(extractDraftSpec(stored(again), catalog))).toEqual(spec);
    const refs = refsFromStepNames(first.steps);
    const byRef = new Map(again.steps.map((step) => [step.id.replace(/^new:/, ''), step]));
    for (const step of first.steps) {
      const other = byRef.get(refs.get(step.id)!)!;
      expect({ ...other, id: step.id, ui: step.ui }).toMatchObject({ type: step.type, name: step.name, assignmentMode: step.assignmentMode, positionId: step.positionId, approvalGroupTypeId: step.approvalGroupTypeId, config: expect.any(Object) });
    }
    expect(again.transitions.map((t) => [t.type, t.label, t.requiresComment])).toEqual([...first.transitions].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => [t.type, t.label, t.requiresComment]));
    expect(again.fields.map((f) => f.code).sort()).toEqual(first.fields.map((f) => f.code).sort());
    expect(again.amountRules.map((r) => [r.action, r.maxAmount, r.currencyCode])).toEqual(first.amountRules.map((r) => [r.action, r.maxAmount, r.currencyCode]));
  });

  it('names the catalog instead of ids, derives refs from step names and leaves assumptions and decisions empty', () => {
    const spec = specOf(extractDraftSpec(stored(translated(advanceSpec())), catalog));
    expect(spec.assumptions).toEqual([]);
    expect(spec.decisions).toEqual([]);
    expect(spec.steps.find((step) => step.name === 'Aprobación de gerencia')).toMatchObject({ ref: 'aprobacion_de_gerencia', assignment: { mode: 'POSITION', position: 'Gerente general' } });
    expect(spec.steps.find((step) => step.name === 'Revisión contable')?.instructions).toBe('Revisa los soportes.\n\nSi falta algo, devuélvelo.');
    expect(spec.fields.find((field) => field.code === 'MOTIVO')?.options).toEqual(['Visita a cliente', 'Capacitación']);
    expect(JSON.stringify(spec)).not.toMatch(/pos-|grp-|type-|00000000-/);
  });

  it('ignores the site scope where the engine does not use it (blocks not assigned by position)', () => {
    const doc = stored(translated(advanceSpec()));
    const sameSite = { ...doc, steps: doc.steps.map((step) => (step.assignmentMode === 'POSITION' ? step : { ...step, siteScope: 'SAME_SITE' as const })) };
    expect(extractDraftSpec(sameSite, catalog).kind).toBe('spec');
  });

  it('reads an empty draft as empty', () => {
    expect(extractDraftSpec({ steps: [], transitions: [], fields: [], amountRules: [] }, catalog)).toEqual({ kind: 'empty' });
  });

  describe('keeps apart what the spec does not show, and refuses what it cannot hold at all', () => {
    const base = () => stored(translated(advanceSpec()));
    const editStep = (doc: WorkflowVersionDocument, name: string, change: Partial<StepDocument>): WorkflowVersionDocument => ({ ...doc, steps: doc.steps.map((step) => (step.name === name ? { ...step, ...change } : step)) });

    it('step settings the builder has and the spec does not, tied to their step', () => {
      const doc = editStep(editStep(base(), 'Pago del anticipo', { siteScope: 'SAME_SITE', allowsBatch: true, config: { batch: { maxTickets: 20 } }, files: [{ fileId: 'file-1', label: 'Formato', sortOrder: 0 }] }), 'Revisión contable', {
        closeRule: 'ALLOWED',
      });
      const extraction = extractDraftSpec(doc, catalog);
      expect(extraction.kind === 'spec' && extraction.basis.hidden.map((loss) => loss.element).sort()).toEqual(['step:pago_del_anticipo', 'step:revision_contable']);
      expect(hiddenOf(doc)).toEqual(
        expect.arrayContaining([
          { subject: 'STEP', name: 'Pago del anticipo', properties: expect.arrayContaining(['siteScope', 'allowsBatch', 'config.batch', 'files']) },
          { subject: 'STEP', name: 'Revisión contable', properties: ['closeRule'] },
        ]),
      );
    });

    it('formatted instructions, read as plain text; plain paragraphs are no hidden setting', () => {
      const formatted = editStep(base(), 'Revisión contable', { description: '<p>Revisa <strong>todo</strong>:</p><ul><li>Soportes</li><li>Montos &amp; fechas</li></ul>' });
      expect(hiddenOf(formatted)).toEqual([{ subject: 'STEP', name: 'Revisión contable', properties: ['description'] }]);
      expect(specOf(extractDraftSpec(formatted, catalog)).steps.find((step) => step.name === 'Revisión contable')?.instructions).toBe('Revisa todo:\n\nSoportes\nMontos & fechas');
      expect(extractDraftSpec(editStep(base(), 'Revisión contable', { description: '<p> Revisa  </p><p></p>' }), catalog).kind).toBe('spec');
    });

    it('blocks, field types and participants the spec has no words for', () => {
      const doc = base();
      const start = doc.steps.find((step) => step.type === 'START')!;
      const withDocument: WorkflowVersionDocument = {
        ...doc,
        steps: [...doc.steps.map((step) => (step.name === 'Corregir la solicitud' ? { ...step, assignmentMode: 'POOL' as const, candidates: [{ id: 'c', participantType: 'USER' as const, userId: 'user-1', positionId: null, groupId: null }] } : step)), { ...start, id: 'doc-step', type: 'DOCUMENT', name: 'Documento' }],
        fields: [...doc.fields, { ...doc.fields[0]!, id: 'user-field', code: 'RESPONSABLE', label: 'Responsable', type: 'USER' }],
      };
      expect(lossesOf(withDocument)).toEqual(
        expect.arrayContaining([
          { subject: 'STEP', name: 'Documento', properties: ['type'] },
          { subject: 'FIELD', name: 'Responsable', properties: ['type'] },
        ]),
      );
      // A pool of people only: the spec has no one to name there.
      expect(lossesOf(editStep(base(), 'Corregir la solicitud', { assignmentMode: 'POOL', positionId: null, candidates: [{ id: 'c', participantType: 'USER', userId: 'user-1', positionId: null, groupId: null }] }))).toEqual([
        { subject: 'STEP', name: 'Corregir la solicitud', properties: [INCOMPLETE_PROPERTY] },
      ]);
      const mixedPool = editStep(base(), 'Corregir la solicitud', {
        assignmentMode: 'POOL',
        positionId: null,
        candidates: [
          { id: 'c1', participantType: 'GROUP', userId: null, positionId: null, groupId: 'grp-it' },
          { id: 'c2', participantType: 'USER', userId: 'user-1', positionId: null, groupId: null },
        ],
      });
      expect(hiddenOf(mixedPool)).toEqual([{ subject: 'STEP', name: 'Corregir la solicitud', properties: ['candidates'] }]);
    });

    it('records the organization no longer offers (an inactive position)', () => {
      expect(lossesOf(editStep(base(), 'Pago del anticipo', { positionId: 'pos-retired' }))).toEqual([{ subject: 'STEP', name: 'Pago del anticipo', properties: ['positionId'] }]);
    });

    it('field, transition and amount rule settings', () => {
      const doc = stored(translated(travelAdvanceSpec()));
      const changed: WorkflowVersionDocument = {
        ...doc,
        fields: doc.fields.map((field) => ({ ...field, isReadOnly: true })),
        transitions: doc.transitions.map((transition) => (transition.label === 'Firmar' ? { ...transition, type: 'SYSTEM_ONLY' as const } : transition)),
        amountRules: doc.amountRules.map((rule) => ({ ...rule, companyId: 'company-1' })),
      };
      expect(hiddenOf(changed)).toEqual(
        expect.arrayContaining([
          { subject: 'FIELD', name: 'MONTO', properties: ['isReadOnly'] },
          { subject: 'TRANSITION', name: 'Firma del anticipo: Firmar', properties: ['type'] },
          { subject: 'AMOUNT_RULE', name: 'MONTO', properties: ['companyId'] },
        ]),
      );
    });

    it('options whose stored value differs from the label', () => {
      const doc = base();
      const withValues = { ...doc, fields: doc.fields.map((field) => (field.code === 'MOTIVO' ? { ...field, config: { options: [{ value: 'V1', label: 'Visita a cliente' }] } } : field)) };
      expect(hiddenOf(withValues)).toEqual([{ subject: 'FIELD', name: 'MOTIVO', properties: ['config.options'] }]);
    });

    it('an incomplete draft and values beyond what the spec allows', () => {
      expect(lossesOf(editStep(base(), 'Pago del anticipo', { assignmentMode: 'NONE', positionId: null }))).toEqual([{ subject: 'STEP', name: 'Pago del anticipo', properties: ['incomplete'] }]);
      expect(lossesOf(editStep(base(), 'Revisión contable', { description: `<p>${'x'.repeat(1_200)}</p>` }))).toEqual([{ subject: 'STEP', name: 'Revisión contable', properties: ['instructions'] }]);
      expect(lossesOf(editStep(base(), 'Avisar el pago', { type: 'WAIT', config: { mode: 'COMPANY_CUTOFF' } }))).toEqual(expect.arrayContaining([{ subject: 'STEP', name: 'Avisar el pago', properties: ['config.mode'] }]));
    });
  });
});

describe('refsFromStepNames', () => {
  it('turns names into unique refs the spec accepts', () => {
    const refs = refsFromStepNames([
      { id: 'a', name: 'Aprobación del Jefe' },
      { id: 'b', name: 'Aprobación del jefe' },
      { id: 'c', name: '2. Pago' },
      { id: 'd', name: '¿¿??' },
      { id: 'e', name: 'x'.repeat(80) },
    ]);
    expect([...refs.values()]).toEqual(['aprobacion_del_jefe', 'aprobacion_del_jefe_2', 'paso_2_pago', 'paso', 'x'.repeat(41)]);
  });
});

describe('plainTextOf', () => {
  it('reads paragraphs and line breaks, and refuses any other formatting', () => {
    expect(plainTextOf('<p>Uno &amp; dos<br />tres</p><p>cuatro</p>')).toBe('Uno & dos\ntres\n\ncuatro');
    expect(plainTextOf('<p></p>')).toBeNull();
    expect(plainTextOf(null)).toBeNull();
    expect(plainTextOf('<p><em>uno</em></p>')).toBeUndefined();
    expect(plainTextOf('<p>uno&hellip;</p>')).toBeUndefined();
  });
});
