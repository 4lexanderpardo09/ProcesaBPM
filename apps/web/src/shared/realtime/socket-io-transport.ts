import { REALTIME_PATH } from '@procesabpm/shared';
import { io } from 'socket.io-client';
import type { OpenSocket, RealtimeSocket } from './realtime-client';

/**
 * The real socket: same origin as the page (the proxy sends `/api/realtime` to the API), WebSocket only (the API
 * accepts nothing else), the token only in the handshake's `auth`, and no automatic reconnection (the client decides,
 * with its own backoff, after reading why the server ended the socket).
 */
export const openSocketIo: OpenSocket = (token) =>
  io(window.location.origin, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    auth: (send: (data: object) => void) => send({ token: token() ?? '' }),
  }) as unknown as RealtimeSocket;
