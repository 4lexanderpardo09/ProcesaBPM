import { Controller, Get, Inject } from '@nestjs/common';
import type { PermissionCatalogGroup } from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { PermissionCatalogService } from '../application/permission-catalog.service.js';

@Controller('permissions')
export class PermissionsController {
  constructor(@Inject(PermissionCatalogService) private readonly catalog: PermissionCatalogService) {}

  /** The permission catalog grouped by subject, for the role editor. */
  @RequirePermission('read', 'Role')
  @Get()
  grouped(): Promise<PermissionCatalogGroup[]> {
    return this.catalog.grouped();
  }
}
