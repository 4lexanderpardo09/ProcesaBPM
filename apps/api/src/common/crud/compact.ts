/**
 * Drops the keys whose value is `undefined`. Request bodies parsed by zod type their optional
 * fields as `T | undefined`, while Prisma (with `exactOptionalPropertyTypes`) wants them absent.
 */
/** A request body as Prisma wants it: optional fields absent instead of `undefined`. */
export type Patch<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

export function compact<T extends object>(value: T): Patch<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Patch<T>;
}
