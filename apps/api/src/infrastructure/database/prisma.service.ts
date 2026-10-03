import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@procesabpm/db';
import { APP_CONFIG } from '../../config/tokens.js';
import type { AppConfig } from '../../config/app-config.js';

/** Columns the runtime role cannot read (docs/base-de-datos.md §8.2); Prisma would select them by default. */
export const SENSITIVE_USER_COLUMNS = {
  passwordHash: true,
  mfaSecretEncrypted: true,
  failedLogins: true,
  lockedUntil: true,
  passwordChangedAt: true,
  mfaEnabledAt: true,
  mfaLastStep: true,
  mfaFailedAttempts: true,
  mfaLockedUntil: true,
} as const;

/**
 * Client of the `app_runtime` login. It is not exported from the database module: tenant data is
 * only reachable through `TenantTransactionRunner`, which fixes the tenant first.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX }),
      omit: { user: SENSITIVE_USER_COLUMNS },
    });
  }

  /** After every `beforeApplicationShutdown` hook: schedulers and background tasks finish their work first. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
