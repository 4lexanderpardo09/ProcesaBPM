import { describe, expect, it } from 'vitest';
import { checkDraftSpec, describeSpecProblems, describeWorkflowProblems } from './feedback.js';
import { workflowDraftSpecSchema, type WorkflowDraftSpec } from './spec.js';
import { advanceSpec, assignment, catalog, draftField, draftStep, link } from './test-fixtures.js';
import { normalizeName, paragraphs, translateDraftSpec } from './translate-spec.js';

function translated(spec: WorkflowDraftSpec) {
  const result = translateDraftSpec(spec, catalog);
  if (!result.ok) throw new Error(`untranslatable: ${JSON.stringify(result.problems)}`);
  return result.document;
}

function problemCodes(spec: WorkflowDraftSpec): string[] {
  const result = translateDraftSpec(spec, catalog);
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

describe('translateDraftSpec', () => {
  it('turns a complete request into a document that passes every publishing check', () => {
    expect(workflowDraftSpecSchema.safeParse(advanceSpec()).success).toBe(true);
    const check = checkDraftSpec(advanceSpec(), catalog);
    expect(check.kind).toBe('translated');
    if (check.kind !== 'translated') return;
    expect(check.errors).toEqual([]);
    expect(check.document.steps.map((step) => step.id)).toContain('new:jefe');
  });

  it('derives the type of each transition from the block it leaves', () => {
    const doc = translated(advanceSpec());
    const typeOf = (from: string, label: string) => doc.transitions.find((t) => t.fromStepId === `new:${from}` && t.label === label)!.type;
    expect(typeOf('inicio', 'Enviar')).toBe('DEFAULT');
    expect(typeOf('jefe', 'Aprobar')).toBe('DECISION');
    expect(typeOf('monto', 'Más de 5 millones')).toBe('CONDITION');
    expect(typeOf('monto', 'Monto normal')).toBe('DEFAULT');
    expect(typeOf('corregir', 'Reenviar')).toBe('DECISION');
    expect(typeOf('aviso', 'Continuar')).toBe('DEFAULT');
  });

  it('keeps a comment requirement only on decisions and a condition only on condition branches', () => {
    const spec = advanceSpec();
    const doc = translated({ ...spec, transitions: spec.transitions.map((t) => (t.label === 'Enviar' ? { ...t, requiresComment: true, condition: [{ field: 'TOTAL', op: 'gt', value: 1 }] } : t)) });
    const send = doc.transitions.find((t) => t.label === 'Enviar')!;
    expect(send).toMatchObject({ type: 'DEFAULT', requiresComment: false, condition: null });
    expect(doc.transitions.find((t) => t.label === 'Rechazar')!.requiresComment).toBe(true);
  });

  it('resolves catalog names without accents, case or extra spaces, and never puts a name where an id goes', () => {
    const spec = advanceSpec();
    const doc = translated({ ...spec, steps: spec.steps.map((s) => (s.ref === 'gerencia' ? { ...s, assignment: assignment({ mode: 'POSITION', position: '  GERENTE   General ' }) } : s)) });
    expect(doc.steps.find((s) => s.id === 'new:gerencia')).toMatchObject({ assignmentMode: 'POSITION', positionId: 'pos-manager' });
    expect(doc.steps.find((s) => s.id === 'new:jefe')).toMatchObject({ assignmentMode: 'APPROVER', approvalGroupTypeId: 'type-boss', approvalLevel: 1 });
    expect(normalizeName('Aprobación  Técnica')).toBe('aprobacion tecnica');
  });

  it('takes the only approval type when the model leaves it empty', () => {
    const spec = advanceSpec();
    const doc = translated({ ...spec, steps: spec.steps.map((s) => (s.ref === 'jefe' ? { ...s, assignment: assignment({ mode: 'APPROVER', approvalLevel: 2 }) } : s)) });
    expect(doc.steps.find((s) => s.id === 'new:jefe')).toMatchObject({ approvalGroupTypeId: 'type-boss', approvalLevel: 2 });
  });

  it('builds group candidates, pools, same-assignee steps and parallel signers', () => {
    const spec: WorkflowDraftSpec = {
      assumptions: [],
      steps: [
        draftStep('inicio', 'START'),
        draftStep('soporte', 'TASK', { assignment: assignment({ mode: 'GROUP', group: 'Mesa TI' }) }),
        draftStep('compras', 'TASK', { assignment: assignment({ mode: 'POOL', poolPositions: ['Contador'], poolGroups: ['Mesa TI'] }) }),
        draftStep('cierre', 'TASK', { assignment: assignment({ mode: 'SAME_AS_STEP', sameAsStep: 'soporte' }) }),
        draftStep('firmas', 'APPROVAL', { assignment: assignment({ mode: 'PARALLEL_APPROVALS', signers: [{ kind: 'POSITION', position: 'Tesorero' }, { kind: 'APPROVER', position: null }, { kind: 'CREATOR', position: null }] }) }),
        draftStep('fin', 'END'),
      ],
      transitions: [
        link('inicio', 'soporte', 'Enviar'),
        link('soporte', 'compras', 'Listo'),
        link('compras', 'cierre', 'Comprado'),
        link('cierre', 'firmas', 'Cerrar'),
        link('firmas', 'fin', 'Firmado'),
        link('firmas', 'cierre', 'Rechazado', { whenRejected: true }),
      ],
      fields: [],
    };
    const check = checkDraftSpec(spec, catalog);
    if (check.kind !== 'translated') throw new Error(JSON.stringify(check.problems));
    expect(check.errors).toEqual([]);
    const step = (ref: string) => check.document.steps.find((s) => s.id === `new:${ref}`)!;
    expect(step('soporte').candidates).toMatchObject([{ participantType: 'GROUP', groupId: 'grp-it' }]);
    expect(step('compras').candidates.map((c) => c.positionId ?? c.groupId)).toEqual(['pos-accountant', 'grp-it']);
    expect(step('cierre').sameAssigneeStepId).toBe('new:soporte');
    expect(step('firmas')).toMatchObject({ assignmentMode: 'PARALLEL', approvalGroupTypeId: 'type-boss', approvalLevel: 1 });
    expect(step('firmas').signers.map((s) => s.signerType)).toEqual(['POSITION', 'APPROVER', 'CREATOR']);
    expect(check.document.transitions.find((t) => t.label === 'Rechazado')!.type).toBe('SYSTEM_ONLY');
  });

  it('captures START fields at creation and the rest in their step, with deduplicated options and table columns', () => {
    const doc = translated(advanceSpec());
    const field = (code: string) => doc.fields.find((f) => f.code === code)!;
    expect(field('DESTINO')).toMatchObject({ capture: 'CREATION', stepId: 'new:inicio', isRequired: true, sortOrder: 0 });
    expect(field('COMPROBANTE')).toMatchObject({ capture: 'STEP', stepId: 'new:pago', sortOrder: 0 });
    expect(field('MOTIVO').config.options).toEqual([
      { value: 'Visita a cliente', label: 'Visita a cliente' },
      { value: 'Capacitación', label: 'Capacitación' },
    ]);
    expect(field('GASTOS').config).toMatchObject({ minRows: 1, columns: [{ code: 'CONCEPTO', showTotal: false }, { code: 'VALOR', showTotal: true }] });
    expect(field('TOTAL')).toMatchObject({ isRequired: false, config: { expression: 'SUM(GASTOS.VALOR)', resultType: 'CURRENCY' } });
  });

  it('writes instructions and notification texts as escaped paragraphs', () => {
    const doc = translated(advanceSpec());
    expect(doc.steps.find((s) => s.id === 'new:contador')!.description).toBe('<p>Revisa los soportes.</p><p>Si falta algo, devuélvelo.</p>');
    expect(doc.steps.find((s) => s.id === 'new:aviso')!.config).toMatchObject({ recipients: [{ kind: 'CREATOR' }], channels: ['IN_APP', 'EMAIL'], body: '<p>Ya puedes ver el comprobante.</p>' });
    expect(paragraphs('<script>alert(1)</script>\nlínea')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;<br>línea</p>');
  });

  it('lays the blocks out in columns by their distance from START', () => {
    const doc = translated(advanceSpec());
    const ui = (ref: string) => doc.steps.find((s) => s.id === `new:${ref}`)!.ui;
    expect(ui('inicio')).toEqual({ x: 0, y: 0 });
    expect(ui('jefe').x).toBe(260);
    expect(ui('monto').x).toBe(520);
    expect(new Set(doc.steps.map((s) => `${s.ui.x},${s.ui.y}`)).size).toBe(doc.steps.length);
  });

  it('reports what cannot be translated, named the way the model wrote it', () => {
    const spec = advanceSpec();
    const broken: WorkflowDraftSpec = {
      ...spec,
      steps: [...spec.steps.map((s) => (s.ref === 'gerencia' ? { ...s, assignment: assignment({ mode: 'POSITION', position: 'Director comercial' }) } : s)), draftStep('fin', 'END'), draftStep('Mal Ref', 'END')],
      transitions: [...spec.transitions, link('pago', 'archivo', 'Archivar')],
      fields: [...spec.fields, draftField('inicio', 'DESTINO', 'TEXT'), draftField('inicio', 'TIPO', 'SELECT'), draftField('monto', 'NOTA', 'TEXT'), draftField('inicio', 'mal', 'TEXT')],
    };
    expect(problemCodes(broken).sort()).toEqual(
      ['SPEC_DUPLICATE_REF', 'SPEC_FIELD_CODE_DUPLICATE', 'SPEC_FIELD_CODE_INVALID', 'SPEC_FIELD_ON_AUTOMATIC_BLOCK', 'SPEC_FIELD_OPTIONS_MISSING', 'SPEC_REF_INVALID', 'SPEC_UNKNOWN_POSITION', 'SPEC_UNKNOWN_REF'].sort(),
    );
    const result = translateDraftSpec(broken, catalog);
    if (result.ok) throw new Error('expected problems');
    const lines = describeSpecProblems(result.problems, broken);
    expect(lines).toContain('SPEC_UNKNOWN_POSITION at step "gerencia" (name=Director comercial)');
    expect(lines).toContain('SPEC_UNKNOWN_REF at transition #12 "Archivar" (pago -> archivo) (target=archivo)');
  });

  it('asks for what a block type needs: an assignment, a notification, a wait, a formula, table columns', () => {
    const spec: WorkflowDraftSpec = {
      assumptions: [],
      steps: [draftStep('inicio', 'START'), draftStep('tarea', 'TASK', { assignment: null }), draftStep('aviso', 'NOTIFICATION'), draftStep('espera', 'WAIT'), draftStep('fin', 'END')],
      transitions: [],
      fields: [draftField('inicio', 'TOTAL', 'FORMULA'), draftField('inicio', 'ITEMS', 'TABLE'), draftField('inicio', 'ANEXOS', 'TABLE', { columns: [{ code: 'X', label: 'X', type: 'FORMULA', required: false, options: null, expression: null, showTotal: false }] })],
    };
    expect(problemCodes(spec).sort()).toEqual(['SPEC_ASSIGNMENT_MISSING', 'SPEC_FIELD_CONFIG_INVALID', 'SPEC_FORMULA_MISSING', 'SPEC_NOTIFICATION_MISSING', 'SPEC_TABLE_COLUMNS_MISSING', 'SPEC_WAIT_MISSING'].sort());
  });

  it('describes the validator problems of a translated draft by ref, label and field code', () => {
    const spec = advanceSpec();
    const check = checkDraftSpec({ ...spec, transitions: spec.transitions.filter((t) => t.from !== 'pago') }, catalog);
    if (check.kind !== 'translated') throw new Error('expected a translation');
    const lines = describeWorkflowProblems(check.errors, check.document);
    expect(lines).toContain('PEOPLE_BLOCK_WITHOUT_DECISION at step "pago"');
    expect(lines.join('\n')).not.toMatch(/new:/);
  });
});
