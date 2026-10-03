import { TICKET_CHANGE_KINDS, type TicketChangeKind, uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';

/** One channel for every signal. `LISTEN`/`NOTIFY` payloads are limited to 8000 bytes: ids only, never data. */
export const REALTIME_CHANNEL = 'procesabpm_realtime';
export const MAX_SIGNAL_BYTES = 7_900;
export const MAX_USERS_PER_SIGNAL = 100;

const nonce = z.string().min(8).max(64);

/**
 * What travels between the worker and the API instances. A signal is a hint that something may have changed, never a
 * source of truth or of authorization: whoever receives it re-checks, per recipient, with the recipient's own session.
 */
const signalSchema = z.discriminatedUnion('k', [
  z.object({ v: z.literal(1), k: z.literal('notifications'), t: uuidSchema, u: z.array(uuidSchema).min(1).max(MAX_USERS_PER_SIGNAL) }).strict(),
  z.object({ v: z.literal(1), k: z.literal('ticket'), t: uuidSchema, id: uuidSchema, e: z.enum(TICKET_CHANGE_KINDS) }).strict(),
  z.object({ v: z.literal(1), k: z.literal('document'), t: uuidSchema, id: uuidSchema, d: uuidSchema }).strict(),
  z.object({ v: z.literal(1), k: z.literal('access'), t: uuidSchema.optional(), u: uuidSchema.optional(), r: uuidSchema.optional(), s: uuidSchema.optional() }).strict(),
  z.object({ v: z.literal(1), k: z.literal('ping'), n: nonce }).strict(),
]);

export type RealtimeSignal = z.infer<typeof signalSchema>;
export type { TicketChangeKind };

/** Splits what does not fit (many users) into several payloads, each under the NOTIFY limit. */
export function encodeSignals(signals: readonly RealtimeSignal[]): string[] {
  const payloads: string[] = [];
  for (const signal of signals) {
    const pieces = signal.k === 'notifications' ? chunk(signal.u, MAX_USERS_PER_SIGNAL).map((u) => ({ ...signal, u })) : [signal];
    for (const piece of pieces) {
      const text = JSON.stringify(piece);
      if (Buffer.byteLength(text, 'utf8') > MAX_SIGNAL_BYTES) throw new Error('A realtime signal exceeds the NOTIFY payload limit');
      payloads.push(text);
    }
  }
  return payloads;
}

/** `undefined` for anything that is not exactly a known signal (oversize, bad JSON, extra keys, non-UUID ids). */
export function decodeSignal(text: string): RealtimeSignal | undefined {
  if (Buffer.byteLength(text, 'utf8') > MAX_SIGNAL_BYTES) return undefined;
  try {
    const parsed = signalSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
