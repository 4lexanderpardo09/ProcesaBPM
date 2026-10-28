import { describe, expect, it } from 'vitest';
import { checkDraftSpec, describeSpecProblems, describeWorkflowProblems } from './feedback.js';
import { workflowDraftSpecSchema, type WorkflowDraftSpec } from './spec.js';
import { advanceSpec, assignment, catalog, draftField, draftStep, link, travelAdvanceSpec } from './test-fixtures.js';
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
      decisions: [],
      initiators: [],
      amountRules: [],
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
    expect(doc.steps.find((s) => s.id === 'new:aviso')!.config).toMatchObject({ recipients: [{ kind: 'CREATOR' }], channels: ['IN_APP', 'EMAIL'], body: 'Ya puedes ver el comprobante.' });
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
      decisions: [],
      initiators: [],
      amountRules: [],
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

  describe('initiators, signature blocks and amount rules', () => {
    const withRule = (patch: Partial<WorkflowDraftSpec['amountRules'][number]>): WorkflowDraftSpec => {
      const spec = travelAdvanceSpec();
      return { ...spec, amountRules: [{ ...spec.amountRules[0]!, ...patch }] };
    };

    it('validates with zero errors and no stray warnings', () => {
      const check = checkDraftSpec(travelAdvanceSpec(), catalog);
      if (check.kind !== 'translated') throw new Error('expected a translation');
      expect(describeWorkflowProblems(check.errors, check.document)).toEqual([]);
    });

    it('puts the initiators on START and nowhere else', () => {
      const doc = translated({ ...travelAdvanceSpec(), initiators: [{ kind: 'POSITION', name: 'contador' }, { kind: 'GROUP', name: 'Mesa TI' }] });
      expect(doc.steps.find((s) => s.type === 'START')!.initiators).toMatchObject([
        { participantType: 'POSITION', positionId: 'pos-accountant', groupId: null },
        { participantType: 'GROUP', groupId: 'grp-it', positionId: null },
      ]);
      expect(doc.steps.filter((s) => s.type !== 'START').flatMap((s) => s.initiators)).toEqual([]);
    });

    it('leaves START open to everyone without initiators, and names unknown ones', () => {
      expect(translated({ ...travelAdvanceSpec(), initiators: [] }).steps.find((s) => s.type === 'START')!.initiators).toEqual([]);
      expect(problemCodes({ ...travelAdvanceSpec(), initiators: [{ kind: 'GROUP', name: 'Nadie' }, { kind: 'POSITION', name: 'Mesa TI' }] })).toEqual(['SPEC_UNKNOWN_GROUP', 'SPEC_UNKNOWN_POSITION']);
    });

    it('builds a SIGNATURE block with its assignee, signers and the main document by default', () => {
      const step = translated(travelAdvanceSpec()).steps.find((s) => s.id === 'new:firma')!;
      expect(step).toMatchObject({ type: 'SIGNATURE', assignmentMode: 'POSITION', positionId: 'pos-treasurer', config: { document: 'MAIN_DOCUMENT' } });
      expect(step.signers.map((signer) => [signer.signerType, signer.positionId, signer.sortOrder])).toEqual([['POSITION', 'pos-treasurer', 0], ['CREATOR', null, 1]]);
    });

    it('takes the document the model chose and the approval type of an APPROVER signer', () => {
      const spec = travelAdvanceSpec();
      const firma = draftStep('firma', 'SIGNATURE', { signatureDocument: 'STEP_DOCUMENT', assignment: assignment({ mode: 'CREATOR', signers: [{ kind: 'APPROVER', position: null }] }) });
      const step = translated({ ...spec, steps: spec.steps.map((s) => (s.ref === 'firma' ? firma : s)) }).steps.find((s) => s.id === 'new:firma')!;
      expect(step).toMatchObject({ config: { document: 'STEP_DOCUMENT' }, approvalGroupTypeId: 'type-boss', approvalLevel: 1 });
    });

    it('refuses a SIGNATURE block without signers, or without assignment, or with an unknown signer position', () => {
      const replaceFirma = (assignmentValue: ReturnType<typeof assignment> | null): WorkflowDraftSpec => {
        const spec = travelAdvanceSpec();
        return { ...spec, steps: spec.steps.map((s) => (s.ref === 'firma' ? { ...s, assignment: assignmentValue } : s)) };
      };
      expect(problemCodes(replaceFirma(assignment({ mode: 'POSITION', position: 'Tesorero' })))).toEqual(['SPEC_SIGNATURE_WITHOUT_SIGNERS']);
      expect(problemCodes(replaceFirma(null))).toEqual(['SPEC_ASSIGNMENT_MISSING']);
      expect(problemCodes(replaceFirma(assignment({ mode: 'CREATOR', signers: [{ kind: 'POSITION', position: 'Notario' }] })))).toEqual(['SPEC_UNKNOWN_POSITION']);
    });

    it('turns the amount rule into a decimal string and derives the SYSTEM_ONLY edge into the approval step', () => {
      const doc = translated(travelAdvanceSpec());
      expect(doc.amountRules).toEqual([
        {
          id: 'new:a0', stepId: 'new:inicio', positionId: null, companyId: null, fieldCode: 'MONTO', rowTypeValue: null, amountColumn: null, typeColumn: null,
          maxAmount: '5000000.00', currencyCode: 'COP', action: 'EXTRA_APPROVAL', approvalStepId: 'new:gerencia', message: 'Más de 5 millones requiere a gerencia.', isActive: true,
        },
      ]);
      expect(doc.transitions.filter((t) => t.type === 'SYSTEM_ONLY')).toMatchObject([{ fromStepId: 'new:inicio', toStepId: 'new:gerencia', requiresComment: false }]);
    });

    it('types a transition the model drew into the approval step as SYSTEM_ONLY instead of adding another', () => {
      const spec = travelAdvanceSpec();
      const doc = translated({ ...spec, transitions: [...spec.transitions, link('inicio', 'gerencia', 'Pedir aprobación')] });
      expect(doc.transitions.filter((t) => t.toStepId === 'new:gerencia')).toMatchObject([{ type: 'SYSTEM_ONLY', label: 'Pedir aprobación' }]);
    });

    it('keeps BLOCK and WARN rules free of approval steps and wiring', () => {
      const doc = translated(withRule({ action: 'WARN', approvalStep: 'gerencia', step: null, currency: 'usd', position: 'Contador', maxAmount: 1234.5 }));
      expect(doc.amountRules[0]).toMatchObject({ action: 'WARN', approvalStepId: null, stepId: null, currencyCode: 'USD', positionId: 'pos-accountant', maxAmount: '1234.50' });
      expect(doc.transitions.some((t) => t.type === 'SYSTEM_ONLY')).toBe(false);
    });

    it('reports amount rule problems by position in the list and by names', () => {
      expect(problemCodes(withRule({ step: null }))).toEqual(['SPEC_AMOUNT_RULE_STEP_REQUIRED']);
      expect(problemCodes(withRule({ approvalStep: null }))).toEqual(['SPEC_AMOUNT_RULE_APPROVAL_STEP_MISSING']);
      expect(problemCodes(withRule({ approvalStep: 'nadie', step: 'tampoco' }))).toEqual(['SPEC_UNKNOWN_REF', 'SPEC_UNKNOWN_REF']);
      expect(problemCodes(withRule({ currency: 'pesos', position: 'Notario' })).sort()).toEqual(['SPEC_AMOUNT_RULE_CURRENCY_INVALID', 'SPEC_UNKNOWN_POSITION']);
      const spec = withRule({ step: null });
      const result = translateDraftSpec(spec, catalog);
      if (result.ok) throw new Error('expected problems');
      expect(describeSpecProblems(result.problems, spec)).toEqual(['SPEC_AMOUNT_RULE_STEP_REQUIRED at amount rule #0, field MONTO']);
    });

    it('lets the validator catch a rule on a missing or non numeric field, described by field code', () => {
      const unknown = checkDraftSpec(withRule({ field: 'NADA' }), catalog);
      const withText = withRule({ field: 'DESTINO' });
      const text = checkDraftSpec({ ...withText, fields: [...withText.fields, draftField('inicio', 'DESTINO', 'TEXT')] }, catalog);
      if (unknown.kind !== 'translated' || text.kind !== 'translated') throw new Error('expected a translation');
      expect(describeWorkflowProblems(unknown.errors, unknown.document)).toContain('AMOUNT_RULE_UNKNOWN_FIELD at amount rule #0 on NADA (code=NADA)');
      expect(describeWorkflowProblems(text.errors, text.document)).toContain('AMOUNT_RULE_FIELD_NOT_NUMERIC at amount rule #0 on DESTINO (code=DESTINO)');
    });

    it('rejects spec values the schema bounds', () => {
      expect(workflowDraftSpecSchema.safeParse(withRule({ maxAmount: -1 })).success).toBe(false);
      expect(workflowDraftSpecSchema.safeParse({ ...travelAdvanceSpec(), initiators: [{ kind: 'USER', name: 'x' }] }).success).toBe(false);
      expect(workflowDraftSpecSchema.safeParse(travelAdvanceSpec()).success).toBe(true);
    });
  });
});
