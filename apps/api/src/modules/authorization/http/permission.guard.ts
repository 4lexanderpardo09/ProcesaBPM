import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { PermissionDeniedError, UnauthenticatedError } from '@procesabpm/shared';
import { type AuthenticatedRequest } from '../../../common/auth/principal.js';
import { accessMetadataOf, classifyAccess } from '../../../common/auth/route-metadata.js';
import { SupportRequestRecorder } from '../../audit/application/support-request-recorder.js';
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
  constructor(
    @Inject(AbilityService) private readonly abilities: AbilityService,
    @Inject(SupportRequestRecorder) private readonly supportAudit: SupportRequestRecorder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.check(context);
    } catch (error) {
      await this.auditSupportDenial(context, error);
      throw error;
    }
  }

  /** A support visit that the permission check refuses leaves a row too: probing hidden subjects is what the tenant must see. */
  private async auditSupportDenial(context: ExecutionContext, error: unknown): Promise<void> {
    if (!(error instanceof PermissionDeniedError)) return;
    const request = context.switchToHttp().getRequest<AbilityRequest>();
    const { principal } = request;
    if (principal?.support === undefined) return;
    await this.supportAudit.record(request, { tenantId: principal.tenantId, userId: principal.userId, grantId: principal.support.grantId }, { outcome: 'DENIED', status: 403, code: 'PERMISSION_DENIED' });
  }

  private async check(context: ExecutionContext): Promise<boolean> {
    const metadata = accessMetadataOf(context.getClass(), context.getHandler());
    const access = classifyAccess(metadata);
    if (access === 'public') return true;
    if (access === 'conflict') throw new PermissionDeniedError('The route declares conflicting access rules');

    const request = context.switchToHttp().getRequest<AbilityRequest>();
    if (access === 'platform') {
      // Platform routes carry a platform principal and never a CASL ability: they act on tenants, they have none.
      if (request.platformPrincipal === undefined) throw new UnauthenticatedError();
      return true;
    }
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
