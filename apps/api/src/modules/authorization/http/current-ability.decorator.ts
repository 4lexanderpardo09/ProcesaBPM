import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { PermissionDeniedError } from '@procesabpm/shared';
import type { AppAbility } from '../domain/build-ability.js';
import type { AbilityRequest } from './permission.guard.js';

/** The ability of the caller, built by the permission guard; use it for per-record checks. */
export const CurrentAbility = createParamDecorator((_data: unknown, context: ExecutionContext): AppAbility => {
  const { ability } = context.switchToHttp().getRequest<AbilityRequest>();
  if (ability === undefined) throw new PermissionDeniedError('No ability for this request');
  return ability;
});
