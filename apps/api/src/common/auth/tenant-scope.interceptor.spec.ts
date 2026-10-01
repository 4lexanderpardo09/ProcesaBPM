import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TenantContext } from '../../infrastructure/database/tenant-context.js';
import type { Principal } from './principal.js';
import { TenantScopeInterceptor } from './tenant-scope.interceptor.js';

const principal: Principal = {
  userId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  tenantId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ac',
  sessionId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad',
};

function run(requestPrincipal: Principal | undefined) {
  const tenantContext = new TenantContext();
  const interceptor = new TenantScopeInterceptor(tenantContext);
  const context = { switchToHttp: () => ({ getRequest: () => ({ principal: requestPrincipal }) }) } as unknown as ExecutionContext;
  const handler: CallHandler = {
    handle: () =>
      defer(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return tenantContext.current();
      }),
  };
  return firstValueFrom(interceptor.intercept(context, handler));
}

describe('TenantScopeInterceptor', () => {
  it('runs the handler inside the tenant context of the principal, across awaits', async () => {
    expect(await run(principal)).toEqual({ tenantId: principal.tenantId, userId: principal.userId });
  });

  it('leaves public requests without a tenant context', async () => {
    expect(await run(undefined)).toBeUndefined();
  });
});
