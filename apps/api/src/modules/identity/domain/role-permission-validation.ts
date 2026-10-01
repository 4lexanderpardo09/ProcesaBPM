import { InvalidConditionError, InvalidReferenceError, type RolePermissionInput, ValidationFailedError } from '@procesabpm/shared';
import { resolveConditionTemplate } from '../../authorization/domain/condition-template.js';
import type { SubjectRegistry } from '../../authorization/domain/subject-registry.js';

/** A member for whom every placeholder has a value: it only serves to check that a condition is well formed. */
const SAMPLE_MEMBER = { userId: 'sample-user', membership: { departmentId: 'sample-department', siteId: 'sample-site' } } as const;

export const permissionKey = (action: string, subject: string): string => `${action}:${subject}`;

const hasConditions = (conditions: RolePermissionInput['conditions']): conditions is Record<string, unknown> => conditions !== null && conditions !== undefined;

/**
 * Checks the permissions a role is about to get: no repeats, every one in the catalog, and conditions
 * only on subjects that registered their fields, well formed and using only those fields. Whatever
 * passes is stored as given (placeholders stay placeholders: they resolve per member at runtime).
 */
export function validateRolePermissions(inputs: readonly RolePermissionInput[], catalogKeys: ReadonlySet<string>, registry: SubjectRegistry): void {
  const seen = new Set<string>();
  const repeated: string[] = [];
  const unknown: string[] = [];
  for (const input of inputs) {
    const key = permissionKey(input.action, input.subject);
    if (seen.has(key)) repeated.push(`${input.action} ${input.subject}`);
    seen.add(key);
    if (!catalogKeys.has(key)) unknown.push(`${input.action} ${input.subject}`);
  }
  if (repeated.length > 0) {
    throw new ValidationFailedError(repeated.map((name) => ({ path: 'permissions', message: `${name} is listed more than once` })));
  }
  if (unknown.length > 0) throw new InvalidReferenceError(`Not in the permission catalog: ${unknown.join(', ')}`);

  for (const input of inputs) {
    if (!hasConditions(input.conditions)) continue;
    const definition = registry.get(input.subject);
    if (definition === undefined) {
      throw new InvalidConditionError(`${input.subject} does not accept conditions`, { details: { action: input.action, subject: input.subject } });
    }
    const checked = resolveConditionTemplate(input.conditions, definition.fields, SAMPLE_MEMBER);
    if (!checked.valid) {
      throw new InvalidConditionError(`Invalid condition on ${input.action} ${input.subject}`, {
        details: { action: input.action, subject: input.subject, reason: checked.reason },
      });
    }
  }
}
