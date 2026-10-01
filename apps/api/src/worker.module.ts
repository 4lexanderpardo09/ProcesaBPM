import { Module } from '@nestjs/common';
import { LoggingModule } from './common/logging/logging.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { WorkerLifecycle } from './worker-lifecycle.js';

@Module({
  imports: [ConfigModule.forEntry('worker'), LoggingModule, DatabaseModule],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}
