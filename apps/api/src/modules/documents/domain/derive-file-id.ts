import { createHash } from 'node:crypto';

/**
 * The id of the file a generation produces, derived from the tenant and the outbox event: every retry of the same
 * event computes the same id and so the same storage key, which is what makes "write the object, then record it" safe
 * to repeat. A version-8 UUID (the one meant for custom, deterministic ids).
 */
export function deriveGeneratedFileId(tenantId: string, eventId: string): string {
  const bytes = createHash('sha256').update(`pdf-file:v1:${tenantId}:${eventId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
