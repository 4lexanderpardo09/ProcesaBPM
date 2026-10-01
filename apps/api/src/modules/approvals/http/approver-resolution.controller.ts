import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ApproverOutcome, type ResolveApproverQuery, resolveApproverQuerySchema } from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { ApproverResolver } from '../application/approver-resolver.service.js';

@Controller('approvals')
export class ApproverResolutionController {
  constructor(@Inject(ApproverResolver) private readonly resolver: ApproverResolver) {}

  /** For the administrator to check a configuration: always answers with the search trace, found or not. */
  @RequirePermission('read', 'ApprovalGroup')
  @Get('resolve')
  resolve(@Query(new ZodValidationPipe(resolveApproverQuerySchema)) query: ResolveApproverQuery): Promise<ApproverOutcome> {
    return this.resolver.diagnose(query);
  }
}
