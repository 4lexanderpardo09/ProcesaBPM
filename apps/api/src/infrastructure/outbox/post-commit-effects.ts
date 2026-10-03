/**
 * Work that must run only after the transaction of an outbox event committed (a real-time signal). Best effort: a
 * failing effect is reported and never rethrown, so it cannot change the outcome of an event that already completed.
 */
export class PostCommitEffects {
  private readonly effects: Array<() => Promise<void>> = [];

  afterCommit(effect: () => Promise<void>): void {
    this.effects.push(effect);
  }

  async run(onError: (error: unknown) => void): Promise<void> {
    for (const effect of this.effects) {
      try {
        await effect();
      } catch (error) {
        onError(error);
      }
    }
  }
}
