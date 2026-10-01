import { createPrismaAbility } from '@casl/prisma/runtime';
import type { Ability, RawRuleFrom } from '@casl/ability';
import { resolveConditionTemplate } from './condition-template.js';
import type { Condition, SubjectContext, SubjectRegistry } from './subject-registry.js';

export type AppAbility = Ability<[string, string], Record<string, unknown>>;

/** A row of `role_permissions` with its catalog entry. */
export interface RawPermissionRule {
  readonly action: string;
  readonly subject: string;
  readonly conditions: unknown;
}

export interface DroppedRule {
  readonly action: string;
  readonly subject: string;
  readonly reason: string;
}

export interface BuiltAbility {
  readonly ability: AppAbility;
  /** Rules that were not applied: invalid conditions or unset placeholders. They are never widened. */
  readonly dropped: readonly DroppedRule[];
}

const hasConditions = (conditions: unknown): boolean => conditions !== null && conditions !== undefined;

/**
 * Builds the CASL ability of a member from the rules of their role.
 * - The catalog names map directly: `manage` and `all` mean what they mean in CASL; no action
 *   implies another (`read` does not imply `read_all`).
 * - The database holds only `can` rules: there is no way to store a `cannot`.
 * - Conditions are checked against the registered fields of the subject. Scoped actions get their
 *   built-in conditions, combined with the stored ones by AND.
 */
export function buildAbility(rules: readonly RawPermissionRule[], context: SubjectContext, registry: SubjectRegistry): BuiltAbility {
  const raw: RawRuleFrom<[string, string], Record<string, unknown>>[] = [];
  const dropped: DroppedRule[] = [];

  for (const rule of rules) {
    const drop = (reason: string) => dropped.push({ action: rule.action, subject: rule.subject, reason });
    const definition = registry.get(rule.subject);
    const implied = definition?.impliedConditions?.[rule.action];

    if (!hasConditions(rule.conditions) && implied === undefined) {
      raw.push({ action: rule.action, subject: rule.subject });
      continue;
    }
    if (definition === undefined) {
      drop('the subject accepts no conditions');
      continue;
    }

    const parts: Condition[] = [];
    if (implied !== undefined) {
      const resolvedImplied = resolveConditionTemplate(implied, definition.fields, context);
      if (!resolvedImplied.valid) {
        drop(`built-in condition: ${resolvedImplied.reason}`);
        continue;
      }
      parts.push(resolvedImplied.condition);
    }
    if (hasConditions(rule.conditions)) {
      const stored = resolveConditionTemplate(rule.conditions, definition.fields, context);
      if (!stored.valid) {
        drop(stored.reason);
        continue;
      }
      parts.push(stored.condition);
    }
    raw.push({ action: rule.action, subject: rule.subject, conditions: parts.length === 1 ? { ...parts[0] } : { AND: parts } });
  }

  return { ability: createPrismaAbility<[string, string]>(raw) as AppAbility, dropped };
}
