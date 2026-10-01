import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ApproverOutcome, PermissionDeniedError, type ResolveApproverQuery, resolveApproverQuerySchema } from '@procesabpm/shared';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { ApproverResolver } from '../application/approver-resolver.service.js';

@Controller('approvals')
export class ApproverResolutionController {
  constructor(@Inject(ApproverResolver) private readonly resolver: ApproverResolver) {}

  /** For the administrator to check a configuration: always answers with the search trace, found or not. */
  @RequirePermission('read', 'ApprovalGroup')
  @Get('resolve')
  resolve(@CurrentAbility() ability: AppAbility, @Query(new ZodValidationPipe(resolveApproverQuerySchema)) query: ResolveApproverQuery): Promise<ApproverOutcome> {
    // Asking for any instant would list other people's delegations one moment at a time: that needs the right to see them.
    if (query.at !== undefined && !ability.can('manage', 'Delegation')) throw new PermissionDeniedError('Resolving at another instant needs manage Delegation');
    return this.resolver.diagnose(query);
  }
}
