import { Controller, Get, Inject } from '@nestjs/common';
import type { MyPermissionsResponse } from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { AbilityService } from '../application/ability.service.js';
import { grantedPermissions } from '../domain/granted-permissions.js';

/** The session's own permissions: any signed-in member may ask for theirs (it says nothing about anyone else). */
@Controller('auth/me')
export class MyPermissionsController {
  constructor(@Inject(AbilityService) private readonly abilities: AbilityService) {}

  @AuthenticatedOnly()
  @Get('permissions')
  async permissions(@CurrentPrincipal() principal: Principal): Promise<MyPermissionsResponse> {
    return { permissions: grantedPermissions(await this.abilities.forPrincipal(principal)) };
  }
}
