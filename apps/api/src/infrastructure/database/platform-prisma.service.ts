import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@procesabpm/db';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/tokens.js';

/**
 * Client of the `app_platform` login, which bypasses row-level security.
 * Only platform services (provisioning, purges) may inject it; never request-scoped code.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.PLATFORM_DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
