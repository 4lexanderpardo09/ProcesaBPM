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
  readonly membership: { readonly departmentId: string | null; readonly siteId: string | null };
}

export type AuthenticatedRequest = Request & { principal?: Principal };

export function principalOf(request: AuthenticatedRequest): Principal {
  if (request.principal === undefined) throw new UnauthenticatedError();
  return request.principal;
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal =>
  principalOf(context.switchToHttp().getRequest<AuthenticatedRequest>()),
);
