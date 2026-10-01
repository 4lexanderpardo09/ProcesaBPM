/** Where a stored condition may point: the placeholders resolved from the acting member. */
export interface SubjectContext {
  readonly userId: string;
  readonly membership: { readonly departmentId?: string | null; readonly siteId?: string | null };
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

  register(subject: string, definition: SubjectDefinition): this {
    this.definitions.set(subject, definition);
    return this;
  }

  get(subject: string): SubjectDefinition | undefined {
    return this.definitions.get(subject);
  }
}
