import { z } from 'zod';
import { uuidSchema } from '../ids.js';

/** Why the e-mail provider told us not to write to an address again (docs/base-de-datos.md §8.34). */
export const EMAIL_SUPPRESSION_REASONS = ['BOUNCE', 'COMPLAINT'] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

export const listEmailSuppressionsQuerySchema = z.object({
  reason: z.enum(EMAIL_SUPPRESSION_REASONS).optional(),
  /** Part of the address. */
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListEmailSuppressionsQuery = z.infer<typeof listEmailSuppressionsQuerySchema>;

export const emailSuppressionSummarySchema = z.object({
  id: uuidSchema,
  email: z.string(),
  reason: z.enum(EMAIL_SUPPRESSION_REASONS),
  /** What the provider said: bounce type and subtype (`Permanent/NoEmail`) or the complaint's feedback type. */
  detail: z.string().nullable(),
  /** Notifications received about this address. */
  events: z.number().int(),
  createdAt: z.string(),
  lastEventAt: z.string(),
});
export type EmailSuppressionSummary = z.infer<typeof emailSuppressionSummarySchema>;
