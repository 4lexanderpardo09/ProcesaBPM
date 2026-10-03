import { Global, Module } from '@nestjs/common';
import { AuditTrail } from './application/audit-trail.js';
import { AuditLogRepository } from './data/audit-log.repository.js';

/** The writer of the trail. Global, and imported by both processes: services that audit are loaded by the API and the worker. */
@Global()
@Module({ providers: [AuditLogRepository, AuditTrail], exports: [AuditTrail, AuditLogRepository] })
export class AuditTrailModule {}
