import { Module } from '@nestjs/common';
import { AuditLogQueriesService } from './application/audit-log-queries.service.js';
import { AuditLogsController } from './http/audit-logs.controller.js';

/** The query side of the trail (`GET /audit-logs`): the API only. */
@Module({ controllers: [AuditLogsController], providers: [AuditLogQueriesService] })
export class AuditModule {}
