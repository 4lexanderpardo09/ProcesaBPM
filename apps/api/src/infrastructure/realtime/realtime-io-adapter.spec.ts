import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { Server } from 'socket.io';
import { describe, expect, it } from 'vitest';
import { OriginPolicy } from './origin-policy.js';
import { admissionRefusal, clientAddressOf, markAuthenticated, RealtimeIoAdapter, SOCKET_SERVER_OPTIONS } from './realtime-io-adapter.js';

type AllowRequest = (request: IncomingMessage, callback: (error: string | null | undefined, success: boolean) => void) => void;

/** An upgrade request coming through a proxy at 10.0.0.1 for the client in `X-Forwarded-For`. */
function upgradeFrom(clientAddress: string): IncomingMessage & { socket: EventEmitter } {
  const socket = Object.assign(new EventEmitter(), { remoteAddress: '10.0.0.1' });
  return { headers: { origin: 'http://app.test', 'x-forwarded-for': clientAddress }, socket, connection: socket } as unknown as IncomingMessage & { socket: EventEmitter };
}

function adapterWith(limits: { maxPendingPerAddress: number }) {
  const adapter = new RealtimeIoAdapter(createServer(), { REALTIME_ALLOWED_ORIGINS: ['http://app.test'], REALTIME_MAX_CONNECTIONS: 100 }, () => true, {
    maxPendingPerAddress: limits.maxPendingPerAddress,
    maxOpenPerAddress: 100,
    maxUpgradesPerWindow: 100,
    windowMs: 60_000,
  });
  const server = adapter.createIOServer(0) as Server;
  const allowRequest = server.engine.opts.allowRequest as AllowRequest;
  const decide = (request: IncomingMessage) => new Promise<boolean>((resolve) => allowRequest(request, (_error, success) => resolve(success)));
  return { server, decide };
}

describe('admissionRefusal', () => {
  const origins = new OriginPolicy(['http://app.test']);

  it('lets an allowed origin in while there is room', () => {
    expect(admissionRefusal(origins, 'http://app.test', 0, 10, false)).toBeUndefined();
  });

  it('refuses another origin or none before looking at the capacity', () => {
    expect(admissionRefusal(origins, 'http://evil.test', 0, 10, false)).toBe('ORIGIN_NOT_ALLOWED');
    expect(admissionRefusal(origins, undefined, 99, 10, false)).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('refuses when the instance is full or shutting down', () => {
    expect(admissionRefusal(origins, 'http://app.test', 10, 10, false)).toBe('SERVER_BUSY');
    expect(admissionRefusal(origins, 'http://app.test', 0, 10, true)).toBe('SERVER_BUSY');
  });
});

describe('SOCKET_SERVER_OPTIONS', () => {
  it('only speaks WebSocket, without compression and with small messages', () => {
    expect(SOCKET_SERVER_OPTIONS).toMatchObject({ transports: ['websocket'], allowUpgrades: false, perMessageDeflate: false, httpCompression: false, serveClient: false, maxHttpBufferSize: 16_384, path: '/realtime' });
  });
});

describe('RealtimeIoAdapter admission', () => {
  it('keys the per-address limits and the client address on the proxied client, released when the connection closes or authenticates', async () => {
    const { server, decide } = adapterWith({ maxPendingPerAddress: 2 });
    try {
      const first = upgradeFrom('203.0.113.9');
      const second = upgradeFrom('203.0.113.9');
      expect([await decide(first), await decide(second)]).toEqual([true, true]);
      expect(clientAddressOf(first)).toBe('203.0.113.9');
      expect(await decide(upgradeFrom('203.0.113.9'))).toBe(false);
      expect(await decide(upgradeFrom('203.0.113.10'))).toBe(true);
      first.socket.emit('close');
      expect(await decide(upgradeFrom('203.0.113.9'))).toBe(true);
      expect(await decide(upgradeFrom('203.0.113.9'))).toBe(false);
      markAuthenticated(second);
      expect(await decide(upgradeFrom('203.0.113.9'))).toBe(true);
      expect(await decide(upgradeFrom('203.0.113.9'))).toBe(false);
    } finally {
      server.close();
    }
  });
});
