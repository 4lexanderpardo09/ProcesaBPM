import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '@procesabpm/shared';
import type { Request } from 'express';

/** Who is calling, as verified by the access token guard. */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  /** Read from the database on every request, never from the token: a demoted user loses access at once. */
  readonly roleId: string;
  /** An inactive role grants nothing. */
  readonly roleActive: boolean;
  /** An active admin role means full access (`manage all`): the admin role is the single source of truth. */
  readonly roleIsAdmin: boolean;
  /** The owner of the tenant has full access whatever their role says. */
  readonly isOwner: boolean;
  /** Bumped by the database on any change of the role's permissions; the cache is keyed by it. */
  readonly permissionsVersion: number;
  readonly membership: { readonly departmentId: string | null; readonly siteId: string | null; readonly positionId: string | null };
  /**
   * Set only for a platform administrator reading the tenant under a support grant. Then `userId` is the administrator
   * (not a member), `sessionId` is the support session, and the ability is the fixed read-only template.
   */
  readonly support?: { readonly grantId: string };
}

/** A platform administrator acting on tenants: no tenant, no CASL ability. */
export interface PlatformPrincipal {
  readonly userId: string;
  readonly sessionId: string;
}

export type AuthenticatedRequest = Request & { principal?: Principal; platformPrincipal?: PlatformPrincipal };

export function principalOf(request: AuthenticatedRequest): Principal {
  if (request.principal === undefined) throw new UnauthenticatedError();
  return request.principal;
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal =>
  principalOf(context.switchToHttp().getRequest<AuthenticatedRequest>()),
);

export const CurrentPlatformPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): PlatformPrincipal => {
  const { platformPrincipal } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (platformPrincipal === undefined) throw new UnauthenticatedError();
  return platformPrincipal;
});
