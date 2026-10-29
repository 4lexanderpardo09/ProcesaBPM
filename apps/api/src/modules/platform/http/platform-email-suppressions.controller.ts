import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type EmailSuppressionSummary, type ListEmailSuppressionsQuery, listEmailSuppressionsQuerySchema, type Page } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { EmailSuppressionAdminService } from '../application/email-suppression-admin.service.js';

@PlatformAdminOnly()
@Controller('platform/email-suppressions')
export class PlatformEmailSuppressionsController {
  constructor(@Inject(EmailSuppressionAdminService) private readonly suppressions: EmailSuppressionAdminService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listEmailSuppressionsQuerySchema)) query: ListEmailSuppressionsQuery): Promise<Page<EmailSuppressionSummary>> {
    return this.suppressions.list(query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.suppressions.remove(admin.userId, id);
  }
}
