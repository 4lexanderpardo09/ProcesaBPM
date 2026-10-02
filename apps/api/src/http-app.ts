import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiConfig } from './config/app-config.js';

const JSON_BODY_LIMIT = '2mb';

/** HTTP settings shared by `main.ts` and the end-to-end tests. */
export function configureHttpApp(app: NestExpressApplication, config: Pick<ApiConfig, 'TRUST_PROXY'>): void {
  app.set('trust proxy', config.TRUST_PROXY);
  // The workflow canvas is saved in one request (up to 500 blocks and 2000 transitions): Express's 100 kb default is too small.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
