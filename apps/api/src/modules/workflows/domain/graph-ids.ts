import { InvalidReferenceError, isNewRef } from '@procesabpm/shared';

/**
 * Gives a final id to every reference of a saved canvas: an existing row keeps its id (it must belong to
 * the version: an id of another version or tenant is refused), a `new:<name>` reference gets one from
 * `allocate`. Returns the map of new references, for the client.
 */
export function resolveReferences(refs: readonly string[], existing: ReadonlySet<string>, allocate: readonly string[], kind: string): Map<string, string> {
  const resolved = new Map<string, string>();
  let next = 0;
  for (const ref of refs) {
    if (isNewRef(ref)) {
      resolved.set(ref, allocate[next]!);
      next += 1;
    } else if (existing.has(ref)) {
      resolved.set(ref, ref);
    } else {
      throw new InvalidReferenceError(`Unknown ${kind} id ${ref}`);
    }
  }
  return resolved;
}

export const countNewRefs = (refs: readonly string[]): number => refs.filter(isNewRef).length;
