import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@procesabpm/db';
import type { ApiConfig } from '../../config/app-config.js';
import { API_CONFIG } from '../../config/tokens.js';
import { SENSITIVE_USER_COLUMNS } from './prisma.service.js';

/** Platform work is rare and administrative: a small pool is enough. */
const PLATFORM_POOL_MAX = 5;

/**
 * Client of the `app_platform` login, which bypasses row-level security. Only the platform module
 * may use it (an architecture test enforces that); never request-scoped tenant code. Like the
 * runtime client, it never selects the sensitive columns of `users`.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    super({
      adapter: new PrismaPg({ connectionString: config.PLATFORM_DATABASE_URL, max: PLATFORM_POOL_MAX }),
      omit: { user: SENSITIVE_USER_COLUMNS },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
