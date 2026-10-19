import { describe, expect, it } from 'vitest';
import { assigneeSummary } from './assignee-summary';

const me = '018f0000-0000-7000-8000-000000000001';
const other = '018f0000-0000-7000-8000-000000000002';
const assignee = (userId: string) => ({ userId, name: 'Ana Pérez', type: 'PRIMARY' as const, assignedAt: '2026-10-18T10:00:00.000Z' });

describe('assigneeSummary', () => {
  it('puts the person first and counts the others once each', () => {
    expect(assigneeSummary({ assignees: [assignee(me), assignee(other), assignee(other)], awaitingDispatch: false }, me)).toEqual({ kind: 'you', others: 1 });
  });

  it('counts the holders when the person is not one of them', () => {
    expect(assigneeSummary({ assignees: [assignee(other)], awaitingDispatch: false }, me)).toEqual({ kind: 'others', count: 1 });
  });

  it('tells a ticket waiting for dispatch from one nobody holds', () => {
    expect(assigneeSummary({ assignees: [], awaitingDispatch: true }, me)).toEqual({ kind: 'awaitingDispatch' });
    expect(assigneeSummary({ assignees: [], awaitingDispatch: false }, me)).toEqual({ kind: 'none' });
  });
});
