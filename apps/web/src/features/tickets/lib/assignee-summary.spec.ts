import { describe, expect, it } from 'vitest';
import { assigneeSummary } from './assignee-summary';

const id = (index: number) => `018f0000-0000-7000-8000-00000000000${index}`;
const assignee = (index: number, name: string) => ({ userId: id(index), name, type: 'PRIMARY' as const, assignedAt: '2026-10-18T10:00:00.000Z' });

describe('assigneeSummary', () => {
  it('names the holders once each, the person first', () => {
    const assignees = [assignee(2, 'Luis Gómez'), assignee(1, 'Ana Pérez'), assignee(2, 'Luis Gómez')];
    expect(assigneeSummary({ assignees, awaitingDispatch: false }, id(1))).toEqual({ kind: 'people', names: ['Ana Pérez', 'Luis Gómez'], more: 0 });
  });

  it('names two and counts the rest', () => {
    const assignees = [assignee(1, 'Ana Pérez'), assignee(2, 'Luis Gómez'), assignee(3, 'Marta Ruiz'), assignee(4, 'Juan Díaz')];
    expect(assigneeSummary({ assignees, awaitingDispatch: false }, undefined)).toEqual({ kind: 'people', names: ['Ana Pérez', 'Luis Gómez'], more: 2 });
  });

  it('tells a ticket waiting for dispatch from one nobody holds', () => {
    expect(assigneeSummary({ assignees: [], awaitingDispatch: true }, id(1))).toEqual({ kind: 'awaitingDispatch' });
    expect(assigneeSummary({ assignees: [], awaitingDispatch: false }, id(1))).toEqual({ kind: 'none' });
  });
});
