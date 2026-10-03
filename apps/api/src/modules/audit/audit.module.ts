import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SupportRequestAuditInterceptor } from './application/support-request-audit.interceptor.js';
import { AuditLogQueriesService } from './application/audit-log-queries.service.js';
import { AuditLogsController } from './http/audit-logs.controller.js';

/** The query side of the trail (`GET /audit-logs`) and the audit of support visits: the API only. */
@Module({ controllers: [AuditLogsController], providers: [AuditLogQueriesService, { provide: APP_INTERCEPTOR, useClass: SupportRequestAuditInterceptor }] })
export class AuditModule {}
