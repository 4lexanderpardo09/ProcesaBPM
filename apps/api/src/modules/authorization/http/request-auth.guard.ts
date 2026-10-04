import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { TenantPendingDeletionError } from '@procesabpm/shared';
import { isAvailableDuringDeletion } from '../../../common/auth/available-during-deletion.decorator.js';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { AccessTokenGuard } from '../../auth/http/access-token.guard.js';
import { PermissionGuard } from './permission.guard.js';

/**
 * The only global guard. Nest does not guarantee the order of several `APP_GUARD`s declared in
 * different modules, so authentication and authorization are chained here explicitly: the permission
 * check can never run before, or without, the access token check. Between the two, a member signed in to an organization
 * pending deletion is kept to the routes marked `@AvailableDuringDeletion()`.
 */
@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenGuard) private readonly authentication: AccessTokenGuard,
    @Inject(PermissionGuard) private readonly authorization: PermissionGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await this.authentication.canActivate(context))) return false;
    this.confineDeletionPending(context);
    return this.authorization.canActivate(context);
  }

  private confineDeletionPending(context: ExecutionContext): void {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (principal?.tenantMode === 'DELETION_PENDING' && !isAvailableDuringDeletion(context.getHandler())) {
      throw new TenantPendingDeletionError();
    }
  }
}
