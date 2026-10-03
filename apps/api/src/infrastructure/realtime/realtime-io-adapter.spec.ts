import { describe, expect, it } from 'vitest';
import { OriginPolicy } from './origin-policy.js';
import { admissionRefusal, SOCKET_SERVER_OPTIONS } from './realtime-io-adapter.js';

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
