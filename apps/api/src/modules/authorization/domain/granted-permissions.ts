import type { MyPermissionsResponse } from '@procesabpm/shared';
import type { AppAbility } from './build-ability.js';

const asList = (value: string | readonly string[]): readonly string[] => (typeof value === 'string' ? [value] : value);

/**
 * The actions an ability grants, one entry per action and subject. Only `can` rules exist (the database cannot store a
 * `cannot`), so nothing is subtracted; a rule with conditions is marked `conditional`, and an unconditional grant of the
 * same pair wins over it.
 */
export function grantedPermissions(ability: AppAbility): MyPermissionsResponse['permissions'] {
  const granted = new Map<string, { action: string; subject: string; conditional: boolean }>();
  for (const rule of ability.rules) {
    if (rule.inverted === true || rule.subject === undefined) continue;
    const conditional = rule.conditions !== undefined;
    for (const action of asList(rule.action)) {
      for (const subject of asList(rule.subject as string | readonly string[])) {
        const key = `${action}:${subject}`;
        const known = granted.get(key);
        if (known === undefined || (known.conditional && !conditional)) granted.set(key, { action, subject, conditional });
      }
    }
  }
  return [...granted.values()].sort((left, right) => left.subject.localeCompare(right.subject) || left.action.localeCompare(right.action));
}
