import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { InvalidTenantContextError, isUuid, MissingTenantContextError } from '@procesabpm/shared';

export interface TenantScope {
  readonly tenantId: string;
  readonly userId: string;
  /** Set when `userId` is a platform administrator acting under a support grant: the audit trail records it. */
  readonly supportGrantId?: string;
}

/** Who is acting on which tenant, for the duration of one request or job. */
@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantScope>();

  /** Throws `InvalidTenantContextError` unless both ids are UUIDs, so garbage never reaches the database. */
  run<T>(scope: TenantScope, work: () => T): T {
    if (!isUuid(scope.tenantId) || !isUuid(scope.userId) || (scope.supportGrantId !== undefined && !isUuid(scope.supportGrantId))) {
      throw new InvalidTenantContextError();
    }
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
