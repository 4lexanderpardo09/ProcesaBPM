import { Global, Module } from '@nestjs/common';
import { AuditLogQueriesService } from './application/audit-log-queries.service.js';
import { AuditTrail } from './application/audit-trail.js';
import { AuditLogRepository } from './data/audit-log.repository.js';
import { AuditLogsController } from './http/audit-logs.controller.js';

/** Global so the modules that audit their actions need not import it; it exports only the writer. */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogRepository, AuditTrail, AuditLogQueriesService],
  exports: [AuditTrail],
})
export class AuditModule {}
