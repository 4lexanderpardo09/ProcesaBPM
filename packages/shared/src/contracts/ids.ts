import { z } from 'zod';

/**
 * Version 1–8 UUIDs with the RFC 9562 variant. Stricter than `z.uuid()`, which also accepts the nil
 * and max UUIDs: one definition shared by the contracts and the API so that whatever passes
 * validation is also accepted as a tenant or user id.
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export const uuidSchema = z.string().regex(UUID_PATTERN, 'Invalid UUID');
