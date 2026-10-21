/** A whole number typed in a box, or `null` when the box is empty or holds something else. */
export function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/** The config of a block with some keys changed; a key set to `undefined` is taken out (the schemas are strict). */
export function patchConfig(config: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}
