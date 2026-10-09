import { uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';

export const STORAGE_QUOTA_EMAIL_EVENT = 'notification.storage_quota_email';

const level = z.union([z.literal(80), z.literal(95)]);
const bytes = z.string().regex(/^\d{1,20}$/);

/** What the files module queues when the usage crosses a threshold (`storage.quota`). */
export const storageQuotaEventSchema = z.object({ level, usedBytes: bytes, limitBytes: bytes }).passthrough();
export type StorageQuotaEvent = z.infer<typeof storageQuotaEventSchema>;

/** One e-mail per administrator: the figures travel with it, so the e-mail tells what was crossed, not today's usage. */
export const storageQuotaEmailSchema = z.object({ userId: uuidSchema, level, usedBytes: bytes, limitBytes: bytes, sourceEventId: uuidSchema }).strict();
export type StorageQuotaEmail = z.infer<typeof storageQuotaEmailSchema>;
