import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from './config/app-config.js';

/** HTTP settings shared by `main.ts` and the end-to-end tests. */
export function configureHttpApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('trust proxy', config.TRUST_PROXY);
}
