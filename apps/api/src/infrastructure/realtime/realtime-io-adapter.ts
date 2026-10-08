import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { REALTIME_PATH } from '@procesabpm/shared';
import proxyaddr from 'proxy-addr';
import { Server, type ServerOptions } from 'socket.io';
import type { ApiConfig } from '../../config/app-config.js';
import { normalizeClientAddress } from '../security/client-address.js';
import { type AdmissionLimits, type AdmissionTicket, ConnectionAdmission, DEFAULT_ADMISSION_LIMITS } from './connection-admission.js';
import { OriginPolicy } from './origin-policy.js';

/** Express's compiled `trust proxy` setting: the socket sees the same client address as the HTTP routes. */
export type TrustProxyFunction = (address: string, hop: number) => boolean;

export type AdmissionSettings = Pick<ApiConfig, 'REALTIME_ALLOWED_ORIGINS' | 'REALTIME_MAX_CONNECTIONS'>;

export type AdmissionRefusal = 'ORIGIN_NOT_ALLOWED' | 'SERVER_BUSY' | 'TOO_MANY_CONNECTIONS';

/** Constants of the protocol (see docs/arquitectura.md §18): no long-polling, no compression, small messages. */
export const SOCKET_SERVER_OPTIONS = {
  path: REALTIME_PATH,
  serveClient: false,
  transports: ['websocket'],
  allowUpgrades: false,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  // A connection that has not sent CONNECT (and so has not authenticated) is closed after this.
  connectTimeout: 5_000,
  maxHttpBufferSize: 16 * 1024,
  perMessageDeflate: false,
  httpCompression: false,
} as const satisfies Partial<ServerOptions>;

const clientAddresses = new WeakMap<IncomingMessage, string>();
const admissionTickets = new WeakMap<IncomingMessage, AdmissionTicket>();
const closingServers = new WeakSet<Server>();

/** The client address resolved before the upgrade (through the trusted proxies). */
export function clientAddressOf(request: IncomingMessage): string {
  return clientAddresses.get(request) ?? request.socket.remoteAddress ?? 'unknown';
}

/** The connection authenticated: it no longer counts against its address's pending connections. */
export function markAuthenticated(request: IncomingMessage): void {
  admissionTickets.get(request)?.authenticated();
}

/** From now on the server refuses new connections (shutdown). */
export function stopAdmitting(server: Server): void {
  closingServers.add(server);
}

/** Why a WebSocket upgrade is refused before any database work, or `undefined` to let it through. */
export function admissionRefusal(origins: OriginPolicy, origin: string | undefined, clientsCount: number, maxConnections: number, closing: boolean): AdmissionRefusal | undefined {
  if (!origins.allows(origin)) return 'ORIGIN_NOT_ALLOWED';
  if (closing || clientsCount >= maxConnections) return 'SERVER_BUSY';
  return undefined;
}

/**
 * Builds the one Socket.IO server of the API with fixed, hardened options; the gateway's own options are ignored. The
 * origin and the capacity are checked in `allowRequest`, before the upgrade (a refusal is an HTTP error, not a socket).
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly origins: OriginPolicy;
  private readonly admission: ConnectionAdmission;

  constructor(
    httpServer: HttpServer,
    private readonly settings: AdmissionSettings,
    private readonly trustProxy: TrustProxyFunction,
    limits: AdmissionLimits = DEFAULT_ADMISSION_LIMITS,
  ) {
    super(httpServer);
    this.origins = new OriginPolicy(settings.REALTIME_ALLOWED_ORIGINS ?? []);
    this.admission = new ConnectionAdmission(limits);
  }

  override createIOServer(port: number): Server {
    const server: Server = super.createIOServer(port, {
      ...SOCKET_SERVER_OPTIONS,
      allowRequest: (request: IncomingMessage, callback: (error: string | null, success: boolean) => void) => {
        const refusal = admissionRefusal(this.origins, request.headers.origin, server.engine.clientsCount, this.settings.REALTIME_MAX_CONNECTIONS, closingServers.has(server));
        if (refusal !== undefined) {
          callback(refusal, false);
          return;
        }
        const address = proxyaddr(request, this.trustProxy);
        // The address is stored whole (logs, session), but the admission counts per /64 for IPv6: one host cannot open
        // a fresh budget by rotating through its /64.
        const ticket = this.admission.admit(normalizeClientAddress(address));
        if (typeof ticket === 'string') {
          callback('TOO_MANY_CONNECTIONS', false);
          return;
        }
        clientAddresses.set(request, address);
        admissionTickets.set(request, ticket);
        // An upgraded connection keeps its TCP socket: its close (for whatever reason) frees the slot exactly once.
        request.socket.once('close', () => ticket.release());
        callback(null, true);
      },
    }) as Server;
    return server;
  }
}
