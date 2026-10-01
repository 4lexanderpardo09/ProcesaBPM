import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type CreateDelegationRequest,
  createDelegationRequestSchema,
  type DelegationResponse,
  type DelegationsQuery,
  delegationsQuerySchema,
  type Page,
} from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { DelegationsService } from '../application/delegations.service.js';

/**
 * Open to every member for their own delegations (`@AuthenticatedOnly`); the service extends that to
 * anyone's delegations for whoever has `manage Delegation` (checked on the caller's ability).
 */
@AuthenticatedOnly()
@Controller('delegations')
export class DelegationsController {
  constructor(@Inject(DelegationsService) private readonly delegations: DelegationsService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @CurrentAbility() ability: AppAbility,
    @Query(new ZodValidationPipe(delegationsQuerySchema)) query: DelegationsQuery,
  ): Promise<Page<DelegationResponse>> {
    return this.delegations.list({ userId: principal.userId, ability }, query);
  }

  @Post()
  create(
    @CurrentPrincipal() principal: Principal,
    @CurrentAbility() ability: AppAbility,
    @Body(new ZodValidationPipe(createDelegationRequestSchema)) body: CreateDelegationRequest,
  ): Promise<DelegationResponse> {
    return this.delegations.create({ userId: principal.userId, ability }, body);
  }

  /** A future delegation is removed (204); one in force ends now (200 with it). */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string): Promise<DelegationResponse | { removed: true }> {
    return (await this.delegations.cancel({ userId: principal.userId, ability }, id)) ?? { removed: true };
  }
}
