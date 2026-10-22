import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type AvailableCatalogQuery, type AvailableCatalogResponse, availableCatalogQuerySchema, PermissionDeniedError } from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { AvailableCatalogService } from '../application/available-catalog.service.js';

@Controller('catalog')
export class AvailableCatalogController {
  constructor(@Inject(AvailableCatalogService) private readonly available: AvailableCatalogService) {}

  /**
   * For whoever creates tickets: their own categories and subcategories, not the whole configuration. Someone who creates
   * for others asks for the requester's (`requesterId`); whether they may for that very ticket is checked on creation.
   */
  @RequireAnyPermission(['create', 'create_for_others'], 'Ticket')
  @Get('available')
  get(
    @CurrentPrincipal() principal: Principal,
    @CurrentAbility() ability: AppAbility,
    @Query(new ZodValidationPipe(availableCatalogQuerySchema)) query: AvailableCatalogQuery,
  ): Promise<AvailableCatalogResponse> {
    if (query.requesterId !== undefined && query.requesterId !== principal.userId && !ability.can('create_for_others', 'Ticket')) throw new PermissionDeniedError('Not allowed to create tickets for others');
    return this.available.available({ userId: principal.userId, departmentId: principal.membership.departmentId }, query.companyId, query.requesterId);
  }
}
