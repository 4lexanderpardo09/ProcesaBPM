import { SubjectRegistry, type SubjectContext } from './subject-registry.js';

/** A stand-in for the future `Ticket`: scoped actions with built-in conditions. Only for tests. */
export const TEST_SUBJECT = 'TestDoc';

export function testRegistry(): SubjectRegistry {
  return new SubjectRegistry().register(TEST_SUBJECT, {
    fields: new Set(['ownerId', 'departmentId', 'siteId', 'status']),
    impliedConditions: { read_own: { ownerId: '${user.id}' } },
  });
}

export const member: SubjectContext = { userId: 'user-1', membership: { departmentId: 'dept-1', siteId: null } };
