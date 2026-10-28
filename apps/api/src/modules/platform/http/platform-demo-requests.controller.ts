import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { type DemoRequestSummary, type ListDemoRequestsQuery, listDemoRequestsQuerySchema, type MarkDemoRequest, markDemoRequestSchema, type Page } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { DemoRequestAdminService } from '../application/demo-request-admin.service.js';

@PlatformAdminOnly()
@Controller('platform/demo-requests')
export class PlatformDemoRequestsController {
  constructor(@Inject(DemoRequestAdminService) private readonly demoRequests: DemoRequestAdminService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listDemoRequestsQuerySchema)) query: ListDemoRequestsQuery): Promise<Page<DemoRequestSummary>> {
    return this.demoRequests.list(query);
  }

  @Put(':id/status')
  mark(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(markDemoRequestSchema)) body: MarkDemoRequest): Promise<DemoRequestSummary> {
    return this.demoRequests.mark(admin.userId, id, body);
  }
}
