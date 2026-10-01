/** Where a stored condition may point: the placeholders resolved from the acting member. */
export interface SubjectContext {
  readonly userId: string;
  readonly membership: { readonly departmentId?: string | null; readonly siteId?: string | null };
}

/**
 * Catalog actions that only make sense with a built-in condition (a scope): without it they would
 * mean "every record". A rule for one of them is applied only when its subject registered the
 * condition; otherwise it is dropped (fail closed). The tickets module registers `Ticket`.
 */
export const CATALOG_SCOPED_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  Ticket: ['read_created', 'read_assigned', 'read_observed'],
};

export function isCatalogScopedAction(subject: string, action: string): boolean {
  return CATALOG_SCOPED_ACTIONS[subject]?.includes(action) ?? false;
}

export type ConditionValue = string | number | boolean | null;
export type Condition = Readonly<Record<string, unknown>>;

export interface SubjectDefinition {
  /** Fields that stored conditions may use; any other field makes the rule invalid. */
  readonly fields: ReadonlySet<string>;
  /**
   * Conditions built into a scoped action (e.g. `read_created` → `{ creatorId: ${user.id} }`).
   * They live in code and are combined with AND with the stored ones, so a stored condition can
   * only narrow a scoped action, never widen it.
   */
  readonly impliedConditions?: Readonly<Record<string, Condition>>;
}

/**
 * The subjects that accept conditions. Subjects not registered here accept none: a rule with
 * conditions on an unregistered subject is dropped. Domain modules register theirs (the tickets
 * module will register `Ticket` with its fields and its scoped actions).
 */
export class SubjectRegistry {
  private readonly definitions = new Map<string, SubjectDefinition>();

  /** A subject is registered once: a second registration would silently replace its conditions. */
  register(subject: string, definition: SubjectDefinition): this {
    if (this.definitions.has(subject)) throw new Error(`The subject ${subject} is already registered`);
    this.definitions.set(subject, definition);
    return this;
  }

  /** Catalog scoped actions whose subject has not registered the built-in condition. */
  unregisteredScopedActions(): Array<{ subject: string; action: string }> {
    return Object.entries(CATALOG_SCOPED_ACTIONS).flatMap(([subject, actions]) =>
      actions.filter((action) => this.definitions.get(subject)?.impliedConditions?.[action] === undefined).map((action) => ({ subject, action })),
    );
  }

  get(subject: string): SubjectDefinition | undefined {
    return this.definitions.get(subject);
  }
}
