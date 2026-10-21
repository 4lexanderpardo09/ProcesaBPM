import { describe, expect, it } from 'vitest';
import { actionLabelKey, subjectLabelKey, subjectOrder } from './permission-labels';

describe('permission labels', () => {
  it('names a subject and its actions, the specific ones first', () => {
    expect(subjectLabelKey('Ticket')).toBe('permissions.subjects.Ticket');
    expect(actionLabelKey('Ticket', 'read_all')).toBe('permissions.specific.ticketReadAll');
    expect(actionLabelKey('Category', 'update')).toBe('permissions.actions.update');
    expect(actionLabelKey('Workflow', 'update')).toBe('permissions.specific.workflowUpdate');
  });

  it('leaves what it does not know to the API words', () => {
    expect(subjectLabelKey('Invoice')).toBeUndefined();
    expect(actionLabelKey('Ticket', 'archive')).toBeUndefined();
    expect(subjectLabelKey('toString')).toBeUndefined();
  });

  it('orders tickets first and unknown subjects last', () => {
    expect(subjectOrder('Ticket')).toBeLessThan(subjectOrder('Company'));
    expect(subjectOrder('Invoice')).toBe(Number.MAX_SAFE_INTEGER);
  });
});
