import { type AiJobChangedPayload, type AuthRequiredPayload, RealtimeClientEvent, RealtimeServerEvent, type SessionEndedPayload, type SessionEndReason, type SyncRequiredPayload } from '@procesabpm/shared';
import type { AccessToken, AccessTokens } from '@/shared/session';

/** What the client needs of a Socket.IO socket (the real one in `socket-io-transport.ts`, a fake in the tests). */
export interface RealtimeSocket {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, listener: (payload: never) => void): void;
  emit(event: string, body: unknown, ack?: (answer: unknown) => void): void;
}

/** Opens a socket that authenticates with whatever `token()` gives at each (re)connection. */
export type OpenSocket = (token: () => string | undefined) => RealtimeSocket;

export interface RealtimeEvents {
  'ai_job.changed': AiJobChangedPayload;
  'sync.required': SyncRequiredPayload;
}
export type RealtimeEventName = keyof RealtimeEvents;

export interface RealtimeClient {
  /** Whether the socket is connected now (while it is not, screens poll more often). */
  isConnected(): boolean;
  onConnectionChange(listener: (connected: boolean) => void): () => void;
  on<E extends RealtimeEventName>(event: E, listener: (payload: RealtimeEvents[E]) => void): () => void;
  /** Follows the AI requests of a draft, again after every reconnection, until the returned function is called. */
  followAiDraft(versionId: string): () => void;
  dispose(): void;
}

export interface RealtimeClientDeps {
  readonly tokens: AccessTokens;
  readonly openSocket: OpenSocket;
  readonly random?: () => number;
  readonly schedule?: (work: () => void, delayMs: number) => () => void;
}

/** Ends after which a new socket would only be refused or would push another tab out. */
const FINAL_REASONS: ReadonlySet<SessionEndReason> = new Set(['SESSION_ENDED', 'REPLACED', 'MFA_REQUIRED', 'TENANT_SUSPENDED']);
const RETRY_MS = { first: 2_000, max: 60_000, maintenance: 60_000 } as const;

const defaultSchedule = (work: () => void, delayMs: number) => {
  const timer = setTimeout(work, delayMs);
  return () => clearTimeout(timer);
};
const sameIdentity = (a: AccessToken | undefined, b: AccessToken | undefined) =>
  a !== undefined && b !== undefined && a.identity.userId === b.identity.userId && a.identity.tenantId === b.identity.tenantId && a.identity.sessionId === b.identity.sessionId;

/**
 * The browser's side of the real time (docs/arquitectura.md §18): one socket per tab while there is a session, opened
 * with the access token and kept on it (`auth.refresh` whenever the token changes, so `auth.required` never ends it),
 * reopened with a jittered backoff after a refused connection or a server end that is not final. Signals are hints:
 * the screens read their data again on each event and on every (re)connection.
 */
export function createRealtimeClient({ tokens, openSocket, random = Math.random, schedule = defaultSchedule }: RealtimeClientDeps): RealtimeClient {
  let socket: RealtimeSocket | undefined;
  let identity: AccessToken | undefined;
  let connected = false;
  let failures = 0;
  let cancelRetry: (() => void) | undefined;
  let disposed = false;
  const drafts = new Map<string, number>();
  const connectionListeners = new Set<(connected: boolean) => void>();
  const eventListeners = new Map<string, Set<(payload: never) => void>>();

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    for (const listener of connectionListeners) listener(value);
  };
  const dispatch = (event: string, payload: unknown) => {
    for (const listener of eventListeners.get(event) ?? []) (listener as (value: unknown) => void)(payload);
  };
  const subscribeDraft = (versionId: string) => socket?.emit(RealtimeClientEvent.AiDraftSubscribe, { versionId }, () => undefined);
  const refreshAuth = () => {
    const token = tokens.current();
    if (socket?.connected === true && token !== undefined) socket.emit(RealtimeClientEvent.AuthRefresh, { token: token.value }, () => undefined);
  };

  function close() {
    cancelRetry?.();
    cancelRetry = undefined;
    const current = socket;
    socket = undefined;
    current?.disconnect();
    setConnected(false);
  }

  function retryLater(delayMs?: number) {
    cancelRetry?.();
    const backoff = Math.min(RETRY_MS.max, RETRY_MS.first * 2 ** failures);
    failures += 1;
    const wait = (delayMs ?? backoff) * (0.5 + random());
    cancelRetry = schedule(() => {
      cancelRetry = undefined;
      open();
    }, wait);
  }

  function open() {
    close();
    if (disposed || tokens.current() === undefined) return;
    identity = tokens.current();
    const next = openSocket(() => tokens.current()?.value);
    socket = next;
    next.on('connect', () => {
      if (socket !== next) return;
      failures = 0;
      for (const versionId of drafts.keys()) subscribeDraft(versionId);
      setConnected(true);
    });
    next.on('disconnect', () => {
      if (socket !== next) return;
      setConnected(false);
      retryLater();
    });
    next.on('connect_error', () => {
      if (socket === next) retryLater();
    });
    next.on(RealtimeServerEvent.AuthRequired, (_payload: AuthRequiredPayload) => refreshAuth());
    next.on(RealtimeServerEvent.SessionEnded, ({ reason }: SessionEndedPayload) => {
      if (socket !== next) return;
      close();
      if (!FINAL_REASONS.has(reason)) retryLater(reason === 'MAINTENANCE' ? RETRY_MS.maintenance : undefined);
    });
    next.on(RealtimeServerEvent.AiJobChanged, (payload: AiJobChangedPayload) => dispatch(RealtimeServerEvent.AiJobChanged, payload));
    next.on(RealtimeServerEvent.SyncRequired, (payload: SyncRequiredPayload) => dispatch(RealtimeServerEvent.SyncRequired, payload));
    next.connect();
  }

  const unsubscribeTokens = tokens.subscribe((token) => {
    if (token === undefined) {
      close();
      identity = undefined;
    } else if (socket === undefined || !sameIdentity(identity, token)) {
      failures = 0;
      open();
    } else {
      refreshAuth();
    }
  });
  open();

  return {
    isConnected: () => connected,
    onConnectionChange(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    on(event, listener) {
      const listeners = eventListeners.get(event) ?? new Set();
      listeners.add(listener as (payload: never) => void);
      eventListeners.set(event, listeners);
      return () => listeners.delete(listener as (payload: never) => void);
    },
    followAiDraft(versionId) {
      const count = drafts.get(versionId) ?? 0;
      drafts.set(versionId, count + 1);
      if (count === 0 && connected) subscribeDraft(versionId);
      let followed = true;
      return () => {
        if (!followed) return;
        followed = false;
        const left = (drafts.get(versionId) ?? 1) - 1;
        if (left > 0) {
          drafts.set(versionId, left);
          return;
        }
        drafts.delete(versionId);
        if (connected) socket?.emit(RealtimeClientEvent.AiDraftUnsubscribe, { versionId }, () => undefined);
      };
    },
    dispose() {
      disposed = true;
      unsubscribeTokens();
      close();
    },
  };
}
