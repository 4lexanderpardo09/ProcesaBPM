import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { InvalidTenantContextError, MissingTenantContextError } from '@procesabpm/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TenantScope {
  readonly tenantId: string;
  readonly userId: string;
}

/** Who is acting on which tenant, for the duration of one request or job. */
@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantScope>();

  /** Throws `InvalidTenantContextError` unless both ids are UUIDs, so garbage never reaches the database. */
  run<T>(scope: TenantScope, work: () => T): T {
    if (!UUID_PATTERN.test(scope.tenantId) || !UUID_PATTERN.test(scope.userId)) {
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
