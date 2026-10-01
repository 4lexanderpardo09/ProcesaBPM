import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '@procesabpm/shared';
import type { Request } from 'express';

/** Who is calling, as verified by the access token guard. */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly sessionId: string;
}

export type AuthenticatedRequest = Request & { principal?: Principal };

export function principalOf(request: AuthenticatedRequest): Principal {
  if (request.principal === undefined) throw new UnauthenticatedError();
  return request.principal;
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal =>
  principalOf(context.switchToHttp().getRequest<AuthenticatedRequest>()),
);
