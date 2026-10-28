import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import type { RealtimeClient, RealtimeEventName, RealtimeEvents } from './realtime-client';

const RealtimeContext = createContext<RealtimeClient | undefined>(undefined);

/** Without a client (tests that do not need one, or a page without a session) the screens fall back to polling. */
export function RealtimeProvider({ client, children }: { readonly client: RealtimeClient | undefined; readonly children: ReactNode }) {
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeClient(): RealtimeClient | undefined {
  return useContext(RealtimeContext);
}

/** Whether the socket is connected; `false` without a client. */
export function useRealtimeConnected(): boolean {
  const client = useRealtimeClient();
  const [connected, setConnected] = useState(() => client?.isConnected() ?? false);
  useEffect(() => {
    setConnected(client?.isConnected() ?? false);
    return client?.onConnectionChange(setConnected);
  }, [client]);
  return connected;
}

/** Calls `listener` on each event (the latest `listener`, without re-subscribing on every render). */
export function useRealtimeEvent<E extends RealtimeEventName>(event: E, listener: (payload: RealtimeEvents[E]) => void): void {
  const client = useRealtimeClient();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => client?.on(event, (payload) => latest.current(payload)), [client, event]);
}
