import { Module } from '@nestjs/common';
import { LoggingModule } from './common/logging/logging.module.js';
import { ConfigModule } from './config/config.module.js';
import { ClockModule } from './infrastructure/clock.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { DispatchModule } from './modules/engine/dispatch.module.js';
import { SlaModule } from './modules/sla/sla.module.js';
import { WorkerLifecycle } from './worker-lifecycle.js';

@Module({
  imports: [ConfigModule.forEntry('worker'), LoggingModule, ClockModule, DatabaseModule, SlaModule, DispatchModule],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}
