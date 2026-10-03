import { Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type FailedOutboxEvent, type ListFailedEventsQuery, listFailedEventsQuerySchema, type Page, type PlatformMetrics } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { OperationsService } from '../application/operations.service.js';

@PlatformAdminOnly()
@Controller('platform/operations')
export class PlatformOperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Get('outbox-events/failed')
  listFailed(@Query(new ZodValidationPipe(listFailedEventsQuerySchema)) query: ListFailedEventsQuery): Promise<Page<FailedOutboxEvent>> {
    return this.operations.listFailedEvents(query);
  }

  @Post('outbox-events/platform/:id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  retryPlatformEvent(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.operations.retryPlatformEvent(admin.userId, id);
  }

  @Post('outbox-events/tenants/:tenantId/:id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  retryTenantEvent(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.operations.retryTenantEvent(admin.userId, tenantId, id);
  }

  @Get('metrics')
  metrics(): Promise<PlatformMetrics> {
    return this.operations.metrics();
  }
}
