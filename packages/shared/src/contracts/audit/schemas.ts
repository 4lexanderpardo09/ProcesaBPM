import { z } from 'zod';
import { uuidSchema } from '../ids.js';

export const AUDIT_DEFAULT_RANGE_DAYS = 30;
export const AUDIT_MAX_RANGE_DAYS = 366;
export const AUDIT_DEFAULT_PAGE_SIZE = 50;
export const AUDIT_MAX_PAGE_SIZE = 100;

/** Filters of `GET /audit-logs`. `action` is an exact action or a prefix ending in a dot (`role.`). */
export const auditLogQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  actorId: uuidSchema.optional(),
  action: z.string().regex(/^[a-z][a-z_]*(\.[a-z_]*)?$/).max(64).optional(),
  subjectType: z.string().regex(/^[A-Za-z]+$/).max(64).optional(),
  subjectId: uuidSchema.optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).default(AUDIT_DEFAULT_PAGE_SIZE),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  at: z.string(),
  actor: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  action: z.string(),
  subjectType: z.string(),
  subjectId: uuidSchema.nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogPageSchema = z.object({ items: z.array(auditLogEntrySchema), nextCursor: uuidSchema.nullable() });
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;
