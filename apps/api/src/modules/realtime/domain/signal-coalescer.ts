/**
 * Collects values by key and merges the ones that share it, until they are drained. Pure: whoever owns it decides
 * when to drain. Draining empties it, so it never holds more than the keys seen since the last drain.
 */
export class SignalCoalescer<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly merge: (current: V, incoming: V) => V) {}

  add(key: string, value: V): void {
    const current = this.entries.get(key);
    this.entries.set(key, current === undefined ? value : this.merge(current, value));
  }

  get size(): number {
    return this.entries.size;
  }

  /** The merged values in the order their keys first arrived; the coalescer is empty afterwards. */
  drain(): V[] {
    const values = [...this.entries.values()];
    this.entries.clear();
    return values;
  }
}
