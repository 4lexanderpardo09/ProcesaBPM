import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type AiAvailabilityResponse,
  type AiDraftRequested,
  type AiFormatHistoryResponse,
  type AiJobHistoryQuery,
  aiJobHistoryQuerySchema,
  type RequestAiFormat,
  requestAiFormatSchema,
} from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { AiFormatRequestsService } from '../application/ai-format-requests.service.js';

/** Jiro in the PDF format designer: whoever may edit a format may ask it to design one. Cancel and status are the workflow drafts' routes. */
@Controller('workflows/:workflowId/pdf-formats/:formatId')
export class AiFormatsController {
  constructor(@Inject(AiFormatRequestsService) private readonly formats: AiFormatRequestsService) {}

  @Get('ai-assistant')
  @RequirePermission('update', 'PdfDocument')
  availability(@CurrentPrincipal() principal: Principal, @Param('workflowId', ParseUUIDPipe) workflowId: string, @Param('formatId', ParseUUIDPipe) formatId: string): Promise<AiAvailabilityResponse> {
    return this.formats.availability(principal, workflowId, formatId);
  }

  @Post('ai-draft')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audited('workflow.ai_format_requested')
  @RequirePermission('update', 'PdfDocument')
  request(
    @CurrentPrincipal() principal: Principal,
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('formatId', ParseUUIDPipe) formatId: string,
    @Body(new ZodValidationPipe(requestAiFormatSchema)) body: RequestAiFormat,
  ): Promise<AiDraftRequested> {
    return this.formats.request(principal, workflowId, formatId, body);
  }

  @Get('ai-jobs')
  @RequirePermission('update', 'PdfDocument')
  history(
    @CurrentPrincipal() principal: Principal,
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('formatId', ParseUUIDPipe) formatId: string,
    @Query(new ZodValidationPipe(aiJobHistoryQuerySchema)) query: AiJobHistoryQuery,
  ): Promise<AiFormatHistoryResponse> {
    return this.formats.history(principal, workflowId, formatId, query);
  }
}
