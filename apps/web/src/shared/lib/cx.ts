/** Joins the class names that are set; CSS module lookups may be `undefined` under `noUncheckedIndexedAccess`. */
export function cx(...classNames: readonly (string | false | null | undefined)[]): string {
  return classNames.filter(Boolean).join(' ');
}
