import { Module } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service.js';
import { PlatformTransactionRunner } from './platform-transaction-runner.js';

/**
 * Exists only in the API entry (the worker has no platform login) and is imported by the platform
 * module alone. `PlatformPrismaService` is not exported: callers go through the runner.
 */
@Module({
  providers: [PlatformPrismaService, PlatformTransactionRunner],
  exports: [PlatformTransactionRunner],
})
export class PlatformDatabaseModule {}
