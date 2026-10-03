import type { INestApplication } from '@nestjs/common';
import { REALTIME_PATH } from '@procesabpm/shared';
import pg from 'pg';
import { io, Manager, type Socket } from 'socket.io-client';
import { REALTIME_CHANNEL } from '../../src/infrastructure/realtime/realtime-signal.js';
import { TEST_REALTIME_ORIGIN } from './test-environment.js';

/** Starts the HTTP server on a free local port (the socket needs a real address) and returns its base URL. */
export async function startListening(app: INestApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  return (await app.getUrl()).replace('[::1]', '127.0.0.1');
}

export interface SocketOptions {
  readonly origin?: string | null;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
}

/** A websocket-only client that does not reconnect by itself (a test decides). `origin: null` sends no Origin header. */
export function connectSocket(url: string, token: string | undefined, options: SocketOptions = {}): Socket {
  const origin = options.origin === undefined ? TEST_REALTIME_ORIGIN : options.origin;
  return io(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 10_000,
    ...(token === undefined ? {} : { auth: { token } }),
    ...(options.query === undefined ? {} : { query: options.query }),
    extraHeaders: { ...(origin === null ? {} : { origin }), ...options.headers },
  });
}

/** The next occurrence of an event (rejects after a timeout). */
export function nextEvent<T>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`No "${event}" within ${timeoutMs} ms`));
    }, timeoutMs);
    const listener = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, listener);
  });
}

/** The next occurrence of an event whose payload satisfies the predicate (earlier ones are skipped). */
export function nextEventWhere<T>(socket: Socket, event: string, predicate: (payload: T) => boolean, timeoutMs = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`No matching "${event}" within ${timeoutMs} ms`));
    }, timeoutMs);
    const listener = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

export const connected = (socket: Socket): Promise<void> => (socket.connected ? Promise.resolve() : nextEvent<void>(socket, 'connect'));

/** The `connect_error` of a refused handshake: its code, or the transport's message when it never got that far. */
export async function connectError(socket: Socket): Promise<{ code?: string; message: string }> {
  const error = await nextEvent<Error & { data?: { code?: string } }>(socket, 'connect_error');
  return { ...(error.data?.code === undefined ? {} : { code: error.data.code }), message: error.message };
}

export async function emitWithAck<T>(socket: Socket, event: string, body: unknown): Promise<T> {
  return (await socket.timeout(10_000).emitWithAck(event, body)) as T;
}

/** Every event a socket receives, in order (to assert that nothing arrived). */
export function recordEvents(socket: Socket): Array<[string, unknown]> {
  const received: Array<[string, unknown]> = [];
  socket.onAny((event: string, payload: unknown) => received.push([event, payload]));
  return received;
}

/** Sends a raw signal on the realtime channel, as the worker or a database trigger would (or as a forger could). */
export async function notifySignal(url: string, signal: Record<string, unknown>): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SELECT pg_notify($1, $2)', [REALTIME_CHANNEL, JSON.stringify(signal)]);
  } finally {
    await client.end();
  }
}

export function closeSockets(...sockets: Socket[]): void {
  for (const socket of sockets) socket.disconnect();
}

/**
 * A WebSocket connection to the engine that never sends CONNECT (so it never authenticates): what an abusive client
 * holds open. Resolves with a closer once accepted, or with the transport error when refused before the upgrade.
 */
export function openUnauthenticatedConnection(url: string, headers: Record<string, string> = {}): Promise<{ close: () => void } | Error> {
  const manager = new Manager(url, { path: REALTIME_PATH, transports: ['websocket'], reconnection: false, autoConnect: false, extraHeaders: { origin: TEST_REALTIME_ORIGIN, ...headers } });
  return new Promise((resolve) => {
    manager.open((error) => resolve(error ?? { close: () => manager.engine.close() }));
  });
}
