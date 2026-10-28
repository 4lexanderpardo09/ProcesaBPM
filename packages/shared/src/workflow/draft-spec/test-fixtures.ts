import type { DraftAssignment, DraftCatalog, DraftField, DraftStep, DraftTransition, WorkflowDraftSpec } from './spec.js';

/** Fixtures for tests: an advance-payment request like the one the model produced in the first probe. */
export const catalog: DraftCatalog = {
  positions: [
    { id: 'pos-manager', name: 'Gerente general' },
    { id: 'pos-accountant', name: 'Contador' },
    { id: 'pos-treasurer', name: 'Tesorero' },
  ],
  groups: [{ id: 'grp-it', name: 'Mesa TI' }],
  approvalTypes: [{ id: 'type-boss', name: 'Jefatura' }],
};

export function assignment(overrides: Partial<DraftAssignment>): DraftAssignment {
  return { mode: 'CREATOR', position: null, group: null, approvalType: null, approvalLevel: null, poolPositions: [], poolGroups: [], sameAsStep: null, signers: [], ...overrides };
}

export function draftStep(ref: string, type: DraftStep['type'], overrides: Partial<DraftStep> = {}): DraftStep {
  const people = type === 'TASK' || type === 'APPROVAL';
  return {
    ref,
    type,
    name: ref,
    instructions: null,
    assignment: people ? assignment({}) : null,
    sla: people ? { value: 1, unit: 'BUSINESS_DAYS' } : null,
    maxLoops: null,
    notification: null,
    wait: null,
    signatureDocument: null,
    ...overrides,
  };
}

export function link(from: string, to: string, label: string, overrides: Partial<DraftTransition> = {}): DraftTransition {
  return { from, to, label, condition: null, requiresComment: false, whenRejected: false, ...overrides };
}

export function draftField(step: string, code: string, type: DraftField['type'], overrides: Partial<DraftField> = {}): DraftField {
  return { step, code, label: code, type, required: true, options: null, formula: null, columns: null, ...overrides };
}

export function advanceSpec(): WorkflowDraftSpec {
  return {
    assumptions: ['El tope de 5 millones se compara con el total de los gastos.'],
    initiators: [],
    amountRules: [],
    steps: [
      draftStep('inicio', 'START', { name: 'Solicitud de anticipo' }),
      draftStep('jefe', 'APPROVAL', { name: 'Aprobación del jefe', assignment: assignment({ mode: 'APPROVER', approvalType: 'Jefatura', approvalLevel: 1 }) }),
      draftStep('monto', 'CONDITION', { name: '¿Supera 5 millones?' }),
      draftStep('gerencia', 'APPROVAL', { name: 'Aprobación de gerencia', assignment: assignment({ mode: 'POSITION', position: 'Gerente general' }) }),
      draftStep('contador', 'TASK', { name: 'Revisión contable', instructions: 'Revisa los soportes.\n\nSi falta algo, devuélvelo.', assignment: assignment({ mode: 'POSITION', position: 'Contador' }) }),
      draftStep('corregir', 'TASK', { name: 'Corregir la solicitud', maxLoops: 3 }),
      draftStep('pago', 'TASK', { name: 'Pago del anticipo', assignment: assignment({ mode: 'POSITION', position: 'Tesorero' }) }),
      draftStep('aviso', 'NOTIFICATION', { name: 'Avisar el pago', notification: { recipients: [{ kind: 'CREATOR', name: null }], subject: 'Tu anticipo fue pagado', body: 'Ya puedes ver el comprobante.' } }),
      draftStep('fin', 'END', { name: 'Fin' }),
    ],
    transitions: [
      link('inicio', 'jefe', 'Enviar'),
      link('jefe', 'monto', 'Aprobar'),
      link('jefe', 'fin', 'Rechazar', { requiresComment: true }),
      link('monto', 'gerencia', 'Más de 5 millones', { condition: [{ field: 'TOTAL', op: 'gt', value: 5_000_000 }] }),
      link('monto', 'contador', 'Monto normal'),
      link('gerencia', 'contador', 'Aprobar'),
      link('gerencia', 'fin', 'Rechazar', { requiresComment: true }),
      link('contador', 'pago', 'Todo correcto'),
      link('contador', 'corregir', 'Devolver', { requiresComment: true }),
      link('corregir', 'contador', 'Reenviar'),
      link('pago', 'aviso', 'Pagado'),
      link('aviso', 'fin', 'Continuar'),
    ],
    fields: [
      draftField('inicio', 'DESTINO', 'TEXT'),
      draftField('inicio', 'MOTIVO', 'SELECT', { options: ['Visita a cliente', 'Capacitación', 'Visita a cliente'] }),
      draftField('inicio', 'GASTOS', 'TABLE', {
        columns: [
          { code: 'CONCEPTO', label: 'Concepto', type: 'TEXT', required: true, options: null, expression: null, showTotal: false },
          { code: 'VALOR', label: 'Valor', type: 'CURRENCY', required: true, options: null, expression: null, showTotal: true },
        ],
      }),
      draftField('inicio', 'TOTAL', 'FORMULA', { formula: { expression: 'SUM(GASTOS.VALOR)', resultType: 'CURRENCY' } }),
      draftField('pago', 'COMPROBANTE', 'FILE'),
    ],
  };
}

/** An advance request using the three richer parts: initiators, a SIGNATURE block and an EXTRA_APPROVAL amount rule. */
export function travelAdvanceSpec(): WorkflowDraftSpec {
  return {
    assumptions: [],
    steps: [
      draftStep('inicio', 'START', { name: 'Solicitud de anticipo de viaje' }),
      draftStep('gerencia', 'APPROVAL', { name: 'Aprobación de gerencia', assignment: assignment({ mode: 'POSITION', position: 'Gerente general' }) }),
      draftStep('firma', 'SIGNATURE', {
        name: 'Firma del anticipo',
        assignment: assignment({ mode: 'POSITION', position: 'Tesorero', signers: [{ kind: 'POSITION', position: 'Tesorero' }, { kind: 'CREATOR', position: null }] }),
      }),
      draftStep('fin', 'END', { name: 'Fin' }),
    ],
    transitions: [
      link('inicio', 'firma', 'Enviar'),
      link('gerencia', 'firma', 'Aprobar'),
      link('gerencia', 'fin', 'Rechazar', { requiresComment: true }),
      link('firma', 'fin', 'Firmar'),
    ],
    fields: [draftField('inicio', 'MONTO', 'CURRENCY')],
    initiators: [{ kind: 'POSITION', name: 'Contador' }],
    amountRules: [{ field: 'MONTO', amountColumn: null, step: 'inicio', maxAmount: 5_000_000, currency: null, action: 'EXTRA_APPROVAL', approvalStep: 'gerencia', position: null, message: 'Más de 5 millones requiere a gerencia.' }],
  };
}
