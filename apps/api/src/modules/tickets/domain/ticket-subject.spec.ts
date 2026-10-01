import { describe, expect, it } from 'vitest';
import { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import { assignedTo, createdBy, observedBy, ticketSubject } from './ticket-subject.js';

describe('ticket subject', () => {
  it('registers the three scoped reads the catalog declares', () => {
    const registry = new SubjectRegistry().register('Ticket', ticketSubject);
    expect(registry.unregisteredScopedActions()).toEqual([]);
  });

  it('read_created covers the creator and whoever registered the ticket', () => expect(createdBy('u')).toEqual({ OR: [{ creatorId: 'u' }, { registeredById: 'u' }] }));

  it('read_assigned covers current and past assignees', () => expect(assignedTo('u')).toEqual({ OR: [{ assignees: { some: { userId: 'u' } } }, { slaClocks: { some: { responsibleId: 'u' } } }] }));

  describe('read_observed', () => {
    it('matches observers by name and by group', () => {
      const condition = observedBy({ userId: 'u', membership: {} }) as { workflow: { observers: { some: { OR: unknown[] } } } };
      expect(condition.workflow.observers.some.OR).toEqual([{ userId: 'u' }, { group: { isActive: true, members: { some: { userId: 'u' } } } }]);
    });
    it('adds the position only when the member has one: a null position would match observers without one', () => {
      const withPosition = observedBy({ userId: 'u', membership: { positionId: 'p' } }) as { workflow: { observers: { some: { OR: unknown[] } } } };
      expect(withPosition.workflow.observers.some.OR).toContainEqual({ positionId: 'p' });
      const nullPosition = observedBy({ userId: 'u', membership: { positionId: null } }) as { workflow: { observers: { some: { OR: unknown[] } } } };
      expect(JSON.stringify(nullPosition)).not.toContain('positionId');
    });
  });
});
