import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type AvailableCatalogQuery, type AvailableCatalogResponse, availableCatalogQuerySchema } from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { AvailableCatalogService } from '../application/available-catalog.service.js';

@Controller('catalog')
export class AvailableCatalogController {
  constructor(@Inject(AvailableCatalogService) private readonly available: AvailableCatalogService) {}

  /** For whoever creates tickets: their own categories and subcategories, not the whole configuration. */
  @RequireAnyPermission(['create', 'create_for_others'], 'Ticket')
  @Get('available')
  get(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(availableCatalogQuerySchema)) query: AvailableCatalogQuery,
  ): Promise<AvailableCatalogResponse> {
    return this.available.available({ userId: principal.userId, departmentId: principal.membership.departmentId }, query.companyId);
  }
}
