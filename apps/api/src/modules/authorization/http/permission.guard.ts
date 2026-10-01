import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { PermissionDeniedError, UnauthenticatedError } from '@procesabpm/shared';
import { type AuthenticatedRequest } from '../../../common/auth/principal.js';
import { accessMetadataOf, classifyAccess } from '../../../common/auth/route-metadata.js';
import { AbilityService } from '../application/ability.service.js';
import type { AppAbility } from '../domain/build-ability.js';

export type AbilityRequest = AuthenticatedRequest & { ability?: AppAbility };

/**
 * Deny by default. Runs after the access token guard (see `RequestAuthGuard`), so a principal exists.
 * An authenticated route must declare `@RequirePermission` / `@RequireAnyPermission`, or be marked
 * `@AuthenticatedOnly`; anything else is refused with 403. This check is type-level: the use case
 * that handles a concrete record still checks the record (`record-access`).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(AbilityService) private readonly abilities: AbilityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = accessMetadataOf(context.getClass(), context.getHandler());
    const access = classifyAccess(metadata);
    if (access === 'public') return true;
    if (access === 'conflict') throw new PermissionDeniedError('The route declares conflicting access rules');

    const request = context.switchToHttp().getRequest<AbilityRequest>();
    if (request.principal === undefined) throw new UnauthenticatedError();
    request.ability = await this.abilities.forPrincipal(request.principal);

    if (access === 'authenticated-only') return true;
    const requirement = metadata.requirement;
    if (access !== 'permission' || requirement === undefined) {
      throw new PermissionDeniedError('The route declares no permission');
    }
    if (!requirement.actions.some((action) => request.ability!.can(action, requirement.subject))) {
      throw new PermissionDeniedError(`Missing permission on ${requirement.subject}`);
    }
    return true;
  }
}
