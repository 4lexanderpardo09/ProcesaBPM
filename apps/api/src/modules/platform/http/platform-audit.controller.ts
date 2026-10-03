import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ListPlatformAuditQuery, listPlatformAuditQuerySchema, type Page, type PlatformAuditEntryResponse } from '@procesabpm/shared';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { PlatformAuditQueryService } from '../application/platform-audit-query.service.js';

/** What platform administrators did, newest first. Read-only: the trail is insert-only in the database. */
@PlatformAdminOnly()
@Controller('platform/audit-logs')
export class PlatformAuditController {
  constructor(@Inject(PlatformAuditQueryService) private readonly audit: PlatformAuditQueryService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listPlatformAuditQuerySchema)) query: ListPlatformAuditQuery): Promise<Page<PlatformAuditEntryResponse>> {
    return this.audit.list(query);
  }
}
