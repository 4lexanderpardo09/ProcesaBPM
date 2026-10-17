import { z } from 'zod';

const CHANNEL_VERSION = 1;

const tokenFields = { token: z.string().min(1), receivedAt: z.number(), expiresAt: z.number() };

export const sessionMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), ...tokenFields }),
  z.object({ type: z.literal('token-request'), requestId: z.string().min(1) }),
  z.object({ type: z.literal('token-response'), requestId: z.string().min(1), ...tokenFields }),
  z.object({ type: z.literal('signed-out'), reason: z.enum(['userSignedOut', 'expired', 'mfaRequired', 'signedOutElsewhere']) }),
]);
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

const envelopeSchema = z.object({ v: z.literal(CHANNEL_VERSION), message: sessionMessageSchema });

export type SessionMessageListener = (message: SessionMessage) => void;

/** Messages between the tabs of this browser profile. What arrives is validated; anything else is ignored. */
export interface SessionChannel {
  post(message: SessionMessage): void;
  subscribe(listener: SessionMessageListener): () => void;
  close(): void;
}

/** Turns raw channel data into a message, or `undefined` for anything malformed or from another version. */
export function readSessionMessage(data: unknown): SessionMessage | undefined {
  const parsed = envelopeSchema.safeParse(data);
  return parsed.success ? parsed.data.message : undefined;
}

export function createBroadcastSessionChannel(name: string): SessionChannel {
  if (typeof BroadcastChannel === 'undefined') return createSilentChannel();
  const channel = new BroadcastChannel(name);
  const listeners = new Set<SessionMessageListener>();
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = readSessionMessage(event.data);
    if (message !== undefined) listeners.forEach((listener) => listener(message));
  };
  return {
    post: (message) => channel.postMessage({ v: CHANNEL_VERSION, message }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => channel.close(),
  };
}

function createSilentChannel(): SessionChannel {
  return { post: () => undefined, subscribe: () => () => undefined, close: () => undefined };
}
