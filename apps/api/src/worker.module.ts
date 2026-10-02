import { Module } from '@nestjs/common';
import { LoggingModule } from './common/logging/logging.module.js';
import { ConfigModule } from './config/config.module.js';
import { ClockModule } from './infrastructure/clock.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { OutboxDispatcherModule } from './infrastructure/outbox/outbox-dispatcher.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { AuthMailModule } from './modules/auth/auth-mail.module.js';
import { DocumentsWorkerModule } from './modules/documents/documents-worker.module.js';
import { NotificationsWorkerModule } from './modules/notifications/notifications-worker.module.js';
import { FilePurgeModule } from './modules/files/file-purge.module.js';
import { DispatchModule } from './modules/engine/dispatch.module.js';
import { SlaModule } from './modules/sla/sla.module.js';
import { WorkerLifecycle } from './worker-lifecycle.js';

@Module({
  imports: [ConfigModule.forEntry('worker'), LoggingModule, ClockModule, DatabaseModule, StorageModule, SlaModule, DispatchModule, FilePurgeModule, OutboxDispatcherModule, AuthMailModule, NotificationsWorkerModule, DocumentsWorkerModule],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}
