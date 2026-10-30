import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '@procesabpm/shared';
import type { NextFunction, Request, Response } from 'express';
import type { ApiConfig } from './config/app-config.js';
import { RealtimeIoAdapter, type TrustProxyFunction } from './infrastructure/realtime/realtime-io-adapter.js';

const JSON_BODY_LIMIT = '2mb';
const TEXT_BODY_LIMIT = '256kb';

export type HttpAppSettings = Pick<ApiConfig, 'TRUST_PROXY' | 'REALTIME_ENABLED' | 'REALTIME_ALLOWED_ORIGINS' | 'REALTIME_MAX_CONNECTIONS'>;

/** HTTP (and WebSocket) settings shared by `main.ts` and the end-to-end tests. Must run before `app.init()`. */
export function configureHttpApp(app: NestExpressApplication, config: HttpAppSettings): void {
  // Express announces itself with X-Powered-By; remove it so responses do not advertise the framework.
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  // Every route, health checks included: the proxy forwards one prefix to the API (see API_PREFIX).
  app.setGlobalPrefix(API_PREFIX);
  // Answers carry one person's data (and tokens, under /auth): no browser or proxy keeps them. A route that may be cached says so itself.
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  // The workflow canvas is saved in one request (up to 500 blocks and 2000 transitions): Express's 100 kb default is too small.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Amazon SNS posts its JSON as text/plain (the SES bounce and complaint endpoint); 256 KB is the most SNS sends.
  app.useBodyParser('text', { type: 'text/plain', limit: TEXT_BODY_LIMIT });
  if (config.REALTIME_ENABLED) {
    // The socket sees the client address exactly as the HTTP routes do (same trusted proxies).
    const express = app.getHttpAdapter().getInstance() as { get(name: string): TrustProxyFunction };
    const trustProxy = express.get('trust proxy fn');
    app.useWebSocketAdapter(new RealtimeIoAdapter(app.getHttpServer(), config, trustProxy));
  }
}
