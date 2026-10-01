import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/http/access-token.guard.js';
import { PermissionGuard } from './permission.guard.js';

/**
 * The only global guard. Nest does not guarantee the order of several `APP_GUARD`s declared in
 * different modules, so authentication and authorization are chained here explicitly: the permission
 * check can never run before, or without, the access token check.
 */
@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenGuard) private readonly authentication: AccessTokenGuard,
    @Inject(PermissionGuard) private readonly authorization: PermissionGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    return (await this.authentication.canActivate(context)) && (await this.authorization.canActivate(context));
  }
}
