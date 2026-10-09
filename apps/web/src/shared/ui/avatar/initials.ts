/** Up to two initials: first and last word of the name, uppercased. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return [first, last].map((word) => (word === undefined ? '' : [...word][0] ?? '')).join('').toLocaleUpperCase('es');
}
