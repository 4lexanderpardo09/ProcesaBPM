import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type AiAvailabilityQuery, aiAvailabilityQuerySchema, type AiAvailabilityResponse, type AiJobResponse, type RequestAiDraft, requestAiDraftSchema } from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { AiDraftRequestsService } from '../application/ai-draft-requests.service.js';

/** «Crear con IA» in the workflow builder: whoever may edit a workflow may ask the assistant for its draft. */
@Controller()
export class AiDraftsController {
  constructor(@Inject(AiDraftRequestsService) private readonly drafts: AiDraftRequestsService) {}

  @Get('ai-assistant/availability')
  @RequirePermission('update', 'Workflow')
  availability(@CurrentPrincipal() principal: Principal, @Query(new ZodValidationPipe(aiAvailabilityQuerySchema)) query: AiAvailabilityQuery): Promise<AiAvailabilityResponse> {
    return this.drafts.availability(principal, query.versionId);
  }

  @Post('workflows/:workflowId/versions/:versionId/ai-draft')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audited('workflow.ai_draft_requested')
  @RequirePermission('update', 'Workflow')
  request(
    @CurrentPrincipal() principal: Principal,
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body(new ZodValidationPipe(requestAiDraftSchema)) body: RequestAiDraft,
  ): Promise<{ jobId: string }> {
    return this.drafts.request(principal, workflowId, versionId, body);
  }

  @Get('ai-jobs/:jobId')
  @RequirePermission('update', 'Workflow')
  job(@CurrentPrincipal() principal: Principal, @Param('jobId', ParseUUIDPipe) jobId: string): Promise<AiJobResponse> {
    return this.drafts.job(principal, jobId);
  }
}
