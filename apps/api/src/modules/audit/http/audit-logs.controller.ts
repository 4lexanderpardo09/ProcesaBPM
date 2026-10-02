import { Controller, Get, Inject, Query } from '@nestjs/common';
import { auditLogQuerySchema, type AuditLogPage, type AuditLogQuery } from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { AuditLogQueriesService } from '../application/audit-log-queries.service.js';

/** Only the roles that hold `read AuditLog` (administrators, through `manage all`). Reading the trail is not itself audited. */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(@Inject(AuditLogQueriesService) private readonly queries: AuditLogQueriesService) {}

  @Get()
  @RequirePermission('read', 'AuditLog')
  list(@Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery): Promise<AuditLogPage> {
    return this.queries.list(query);
  }
}
