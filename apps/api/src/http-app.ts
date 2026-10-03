import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiConfig } from './config/app-config.js';
import { RealtimeIoAdapter, type TrustProxyFunction } from './infrastructure/realtime/realtime-io-adapter.js';

const JSON_BODY_LIMIT = '2mb';

export type HttpAppSettings = Pick<ApiConfig, 'TRUST_PROXY' | 'REALTIME_ENABLED' | 'REALTIME_ALLOWED_ORIGINS' | 'REALTIME_MAX_CONNECTIONS'>;

/** HTTP (and WebSocket) settings shared by `main.ts` and the end-to-end tests. Must run before `app.init()`. */
export function configureHttpApp(app: NestExpressApplication, config: HttpAppSettings): void {
  app.set('trust proxy', config.TRUST_PROXY);
  // The workflow canvas is saved in one request (up to 500 blocks and 2000 transitions): Express's 100 kb default is too small.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  if (config.REALTIME_ENABLED) {
    // The socket sees the client address exactly as the HTTP routes do (same trusted proxies).
    const express = app.getHttpAdapter().getInstance() as { get(name: string): TrustProxyFunction };
    const trustProxy = express.get('trust proxy fn');
    app.useWebSocketAdapter(new RealtimeIoAdapter(app.getHttpServer(), config, trustProxy));
  }
}
