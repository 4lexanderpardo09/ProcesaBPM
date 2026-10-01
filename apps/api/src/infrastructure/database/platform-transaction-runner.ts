import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/tokens.js';
import { PlatformPrismaService } from './platform-prisma.service.js';

export type PlatformTransaction = Prisma.TransactionClient;

/**
 * The only way to open a transaction with the platform login. It bypasses row-level security, so
 * every statement that writes tenant data must carry an explicit `tenant_id`.
 */
@Injectable()
export class PlatformTransactionRunner {
  constructor(
    @Inject(PlatformPrismaService) private readonly platform: PlatformPrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  run<T>(work: (tx: PlatformTransaction) => Promise<T>): Promise<T> {
    return this.platform.$transaction(work, { timeout: this.config.DB_TX_TIMEOUT_MS, maxWait: this.config.DB_TX_MAX_WAIT_MS });
  }
}
