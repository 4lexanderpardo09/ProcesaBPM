import type { ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AccessTokenGuard } from '../../auth/http/access-token.guard.js';
import type { PermissionGuard } from './permission.guard.js';
import { RequestAuthGuard } from './request-auth.guard.js';

const context = {} as ExecutionContext;

function setup(authentication: () => Promise<boolean>, authorization: () => Promise<boolean> = () => Promise.resolve(true)) {
  const order: string[] = [];
  const auth = { canActivate: vi.fn(async () => (order.push('token'), authentication())) };
  const permission = { canActivate: vi.fn(async () => (order.push('permission'), authorization())) };
  const guard = new RequestAuthGuard(auth as unknown as AccessTokenGuard, permission as unknown as PermissionGuard);
  return { guard, order, auth, permission };
}

describe('RequestAuthGuard', () => {
  it('checks the access token first and the permission second', async () => {
    const { guard, order } = setup(() => Promise.resolve(true));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(order).toEqual(['token', 'permission']);
  });

  it('never runs the permission check when authentication fails', async () => {
    const { guard, permission } = setup(() => Promise.reject(new UnauthenticatedError()));
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(permission.canActivate).not.toHaveBeenCalled();
  });

  it('never runs the permission check when authentication does not grant access', async () => {
    const { guard, permission } = setup(() => Promise.resolve(false));
    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(permission.canActivate).not.toHaveBeenCalled();
  });

  it('answers what the permission check answers', async () => {
    const { guard } = setup(() => Promise.resolve(true), () => Promise.resolve(false));
    await expect(guard.canActivate(context)).resolves.toBe(false);
  });
});
