import type { FieldDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { codeFromLabel, fieldsOf, isFieldCode, removeField, setStepChildren, upsertField } from './content-doc';

const field = (id: string, sortOrder: number, label: string): FieldDocument => ({ id, stepId: 's', code: id.toUpperCase(), label, type: 'TEXT', capture: 'BOTH', isRequired: false, isReadOnly: false, sortOrder, config: {}, dataSource: null });
const empty: WorkflowVersionDocument = { steps: [], transitions: [], fields: [], amountRules: [] };

describe('content document', () => {
  it('adds, replaces and removes fields', () => {
    let doc = upsertField(empty, field('a', 0, 'Monto'));
    doc = upsertField(doc, { ...field('a', 0, 'Monto'), label: 'Monto total' });
    expect(doc.fields.map((candidate) => candidate.label)).toEqual(['Monto total']);
    expect(removeField(doc, 'a').fields).toEqual([]);
  });

  it('lists the fields of a block in their order', () => {
    const doc = { ...empty, fields: [field('b', 2, 'B'), field('a', 1, 'A'), { ...field('c', 0, 'C'), stepId: 'other' }] };
    expect(fieldsOf(doc, 's').map((candidate) => candidate.id)).toEqual(['a', 'b']);
  });

  it('replaces the lists of one block', () => {
    const doc: WorkflowVersionDocument = {
      ...empty,
      steps: [{ id: 's', candidates: [], initiators: [], signers: [], slaOverrides: [], files: [] } as unknown as WorkflowVersionDocument['steps'][number]],
    };
    const children = { candidates: [{ id: 'c', participantType: 'USER' as const, userId: 'u', positionId: null, groupId: null }], initiators: [], signers: [], slaOverrides: [], files: [] };
    expect(setStepChildren(doc, 's', children).steps[0]!.candidates).toHaveLength(1);
  });

  it('suggests a code from the label: upper snake case, no accents, unique', () => {
    expect(codeFromLabel('Monto total', new Set())).toBe('MONTO_TOTAL');
    expect(codeFromLabel('  ¿Fecha de pago?  ', new Set())).toBe('FECHA_DE_PAGO');
    expect(codeFromLabel('Número de cédula', new Set())).toBe('NUMERO_DE_CEDULA');
    expect(codeFromLabel('2 firmas', new Set())).toBe('F_2_FIRMAS');
    expect(codeFromLabel('Monto', new Set(['MONTO', 'MONTO_2']))).toBe('MONTO_3');
    expect(codeFromLabel('¿?', new Set())).toBe('');
    expect(isFieldCode(codeFromLabel('x'.repeat(300), new Set()))).toBe(true);
  });
});
