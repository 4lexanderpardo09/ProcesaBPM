import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

const booleanQuerySchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/** Query of every paginated listing: text filter and optional inclusion of deactivated records. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(100).optional(),
  includeInactive: booleanQuerySchema,
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export const nameSchema = z.string().trim().min(1).max(200);

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB');

/** `YYYY-MM-DD` that is a real calendar day. */
export const isoDateSchema = z
  .string()
  .regex(/^(19|20)\d{2}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Not a valid date');

/** `HH:mm`, 24-hour clock. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
