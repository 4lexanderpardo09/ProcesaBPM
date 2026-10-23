import { type FieldDocument, pdfCanvasDesignSchema, type StepDocument, validateDesign, type WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { starterCanvasDesign, type StarterLabels } from './starter-design';

const labels: StarterLabels = { requestData: 'Datos de la solicitud', company: 'Empresa', requester: 'Solicitante', createdAt: 'Fecha', status: 'Estado', signatures: 'Firmas', requesterSignature: 'Solicitante', total: 'Total', noRows: 'Sin filas', page: 'Página' };
const step = (id: string, name: string, type: StepDocument['type']) => ({ id, name, type }) as StepDocument;
const field = (code: string, label: string, type: FieldDocument['type'], config: Record<string, unknown> = {}) => ({ code, label, type, config, stepId: 'start' }) as unknown as FieldDocument;
const doc = (fields: FieldDocument[]): WorkflowVersionDocument =>
  ({ steps: [step('start', 'Inicio', 'START'), step('count', 'Arqueo', 'TASK'), step('review', 'Revisión {de} caja', 'APPROVAL'), step('end', 'Fin', 'END')], transitions: [], fields, amountRules: [] }) as unknown as WorkflowVersionDocument;

const cash = [
  field('CASHIER', 'Cajero', 'TEXT'),
  field('AMOUNT', 'Total contado', 'CURRENCY'),
  field('NOTES', 'Observaciones', 'TEXTAREA'),
  field('SUPPORT', 'Soporte', 'FILE'),
  field('BILLS', 'Billetes', 'TABLE', { columns: [{ code: 'DENOM', label: 'Denominación', type: 'TEXT' }, { code: 'QTY', label: 'Cantidad', type: 'NUMBER' }, { code: 'VALUE', label: 'Valor', type: 'CURRENCY' }] }),
];

describe('starterCanvasDesign', () => {
  it('draws a format the workflow can save at once: header, data grid, long text, tables with totals and signatures', () => {
    const design = starterCanvasDesign(doc(cash), 'Arqueo de caja {F23}', labels);
    expect(pdfCanvasDesignSchema.safeParse(design).success).toBe(true);
    expect(validateDesign(design, doc(cash))).toEqual([]);

    const texts = design.elements.flatMap((element) => (element.type === 'text' ? [element.content] : []));
    expect(texts).toContain('ARQUEO DE CAJA F23');
    expect(texts).toEqual(expect.arrayContaining(['{{field.CASHIER}}', '{{field.AMOUNT|currency}}', '{{field.NOTES}}', '{{ticket.creatorName}}']));
    expect(texts.join(' ')).not.toContain('SUPPORT');
    const table = design.elements.find((element) => element.type === 'table');
    expect(table).toMatchObject({ fieldCode: 'BILLS', showTotals: true, columns: [{ value: '{{row.DENOM}}', sum: false }, { value: '{{row.QTY|number}}', align: 'RIGHT', sum: true }, { value: '{{row.VALUE|currency}}', sum: true }] });
    const signatures = design.elements.flatMap((element) => (element.type === 'signature' ? [[element.source, element.stepName]] : []));
    expect(signatures).toEqual([['REQUESTER', null], ['STEP', 'Arqueo'], ['STEP', 'Revisión {de} caja']]);
    expect(design.elements.filter((element) => element.repeat).map((element) => element.name)).toEqual(['Logo', 'Título', 'Número y fecha', 'Página']);
  });

  it('stops the grid before the signatures, whatever the number of fields', () => {
    const many = Array.from({ length: 120 }, (_, index) => field(`F${String(index)}`, `Campo ${String(index)}`, 'TEXT'));
    const design = starterCanvasDesign(doc(many), 'Largo', labels);
    expect(pdfCanvasDesignSchema.safeParse(design).success).toBe(true);
    const lowest = Math.max(...design.elements.filter((element) => !element.repeat).map((element) => element.y + element.height));
    expect(lowest).toBeLessThan(264);
  });
});
