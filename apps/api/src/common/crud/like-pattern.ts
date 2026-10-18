/**
 * `%`, `_` and `\` typed by a person are plain characters in a search, not wildcards. Prisma's `contains`
 * passes its value to `LIKE`/`ILIKE` as is, so every text search escapes it first (`\` is PostgreSQL's
 * default escape character).
 */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (character) => `\\${character}`);

/** A raw `LIKE` pattern that finds the text anywhere. */
export const likeContains = (text: string): string => `%${escapeLike(text)}%`;
