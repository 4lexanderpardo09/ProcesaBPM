import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { MissingTenantContextError } from '@procesabpm/shared';

export interface TenantScope {
  readonly tenantId: string;
  readonly userId: string;
}

/** Who is acting on which tenant, for the duration of one request or job. */
@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantScope>();

  run<T>(scope: TenantScope, work: () => T): T {
    return this.storage.run(scope, work);
  }

  current(): TenantScope | undefined {
    return this.storage.getStore();
  }

  require(): TenantScope {
    const scope = this.current();
    if (scope === undefined) throw new MissingTenantContextError();
    return scope;
  }
}
