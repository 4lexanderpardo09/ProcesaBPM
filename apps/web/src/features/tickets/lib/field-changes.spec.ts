import type { FormFieldResponse } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { fieldChanges } from './field-changes';

const NAMES = { users: {}, sites: {}, companies: {}, departments: {}, positions: {} };
const PRIORITY = '018f0000-0000-7000-8000-000000000001';

const field = (code: string, label: string, type: string, config: Record<string, unknown> = {}): FormFieldResponse =>
  ({ id: '018f0000-0000-7000-8000-000000000010', stepId: '018f0000-0000-7000-8000-000000000011', code, label, type, isRequired: false, isReadOnly: false, sortOrder: 1, config, dataSource: null }) as FormFieldResponse;

describe('fieldChanges', () => {
  it('reads an edit of the header: subject, description and priority', () => {
    const data = {
      source: 'EDIT',
      changes: [
        { code: 'title', before: 'Pago', after: 'Pago de octubre' },
        { code: 'descriptionHtml', before: '<p>a</p>', after: '<p>b</p>' },
        { code: 'priorityId', before: null, after: PRIORITY },
      ],
    };
    expect(fieldChanges(data, [], NAMES)).toEqual([
      { kind: 'title', before: 'Pago', after: 'Pago de octubre' },
      { kind: 'description' },
      { kind: 'priority', before: null, after: PRIORITY },
    ]);
  });

  it('labels a form field and formats its values the way the ticket shows them', () => {
    const options = { options: [{ value: 'capital', label: 'Abono a capital' }, { value: 'interest', label: 'Intereses' }] };
    const data = { changes: [{ code: 'paymentType', before: 'capital', after: 'interest' }, { code: 'notes', before: null, after: 'listo' }] };
    expect(fieldChanges(data, [field('paymentType', 'Tipo de pago', 'SELECT', options), field('notes', 'Observaciones', 'TEXTAREA')], NAMES)).toEqual([
      { kind: 'field', label: 'Tipo de pago', before: { kind: 'text', text: 'Abono a capital' }, after: { kind: 'text', text: 'Intereses' } },
      { kind: 'field', label: 'Observaciones', before: undefined, after: { kind: 'text', text: 'listo' } },
    ]);
  });

  it('keeps the code of a field the version no longer has', () => {
    expect(fieldChanges({ changes: [{ code: 'ALLOWANCE', before: null, after: 15000 }, { code: 'rows', before: [], after: [{}] }] }, [], NAMES)).toEqual([
      { kind: 'field', label: 'ALLOWANCE', before: undefined, after: { kind: 'text', text: '15000' } },
      { kind: 'field', label: 'rows', before: { kind: 'unknown' }, after: { kind: 'unknown' } },
    ]);
  });

  it('reads an event of another shape as no change', () => {
    expect(fieldChanges({}, [], NAMES)).toEqual([]);
    expect(fieldChanges(null, [], NAMES)).toEqual([]);
  });
});
