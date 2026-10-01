import { subject as caslSubject } from '@casl/ability';
import { accessibleBy } from '@casl/prisma/runtime';
import { PermissionDeniedError } from '@procesabpm/shared';
import { type AppAbility, requiredFieldsOf } from './build-ability.js';

/** A record as the use case loaded it: only the fields its conditions refer to are needed. */
export type SubjectRecord = Readonly<Record<string, unknown>>;

/** Matches nothing; used instead of an empty filter, which would match everything. */
const MATCH_NOTHING = Object.freeze({ id: { in: [] as string[] } });

/**
 * A type-level `ability.can(action, 'Ticket')` is true as soon as ANY rule exists, even a conditional
 * one, so it must not authorize access to a concrete record. These helpers check the record itself.
 * The record must carry every field the rules of its type refer to (load them all), and is copied:
 * CASL's `subject()` writes the subject type into the object it receives.
 */
export function canOnRecord(ability: AppAbility, action: string, subjectType: string, record: SubjectRecord): boolean {
  // A condition such as `{ status: { not: 'X' } }` passes when the field is missing, so a record that
  // lacks a field some rule refers to is denied instead of being judged on what happens to be loaded.
  for (const field of requiredFieldsOf(ability, subjectType)) {
    if (record[field] === undefined) return false;
  }
  return ability.can(action, caslSubject(subjectType, { ...record }) as never);
}

/** Any one of the actions grants access (e.g. read_created, read_assigned, read_observed, read_all). */
export function canAnyOnRecord(ability: AppAbility, actions: readonly string[], subjectType: string, record: SubjectRecord): boolean {
  return actions.some((action) => canOnRecord(ability, action, subjectType, record));
}

export function assertCanOnRecord(ability: AppAbility, actions: string | readonly string[], subjectType: string, record: SubjectRecord): void {
  const list = typeof actions === 'string' ? [actions] : actions;
  if (!canAnyOnRecord(ability, list, subjectType, record)) throw new PermissionDeniedError(`Not allowed on this ${subjectType}`);
}

/**
 * Prisma `where` for listings: the records the ability allows for any of the actions. A rule without
 * conditions gives `{}` (every record); without any rule for the subject it is a filter that matches
 * nothing, never `{}`.
 */
export function accessibleWhere(ability: AppAbility, actions: string | readonly string[], subjectType: string): Record<string, unknown> {
  const list = typeof actions === 'string' ? [actions] : actions;
  const filters = list.filter((action) => ability.can(action, subjectType)).map((action) => accessibleBy(ability, action).ofType(subjectType as never) as Record<string, unknown>);
  if (filters.length === 0) return { ...MATCH_NOTHING };
  // An action granted without conditions means every record: `OR: [{...}, {}]` must not be left to the database, which would not read it that way.
  if (filters.some((filter) => Object.keys(filter).length === 0)) return {};
  return filters.length === 1 ? filters[0]! : { OR: filters };
}
