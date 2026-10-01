/**
 * Drops the keys whose value is `undefined`. Request bodies parsed by zod type their optional
 * fields as `T | undefined`, while Prisma (with `exactOptionalPropertyTypes`) wants them absent.
 */
export function compact<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
