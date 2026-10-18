import type { SessionChannel, SessionMessage, SessionMessageListener } from '@/shared/session/session-channel';

/** BroadcastChannel stand-in: a message reaches every other channel of the hub, asynchronously, never the sender. */
export function createFakeChannelHub() {
  const channels = new Set<Set<SessionMessageListener>>();
  const posted: SessionMessage[] = [];

  function channel(): SessionChannel {
    const listeners = new Set<SessionMessageListener>();
    channels.add(listeners);
    return {
      post(message) {
        posted.push(message);
        for (const other of channels) {
          if (other !== listeners) queueMicrotask(() => other.forEach((listener) => listener(message)));
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close: () => channels.delete(listeners),
    };
  }

  return { channel, posted };
}
