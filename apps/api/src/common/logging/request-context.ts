import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestScope {
  readonly requestId: string;
  /** The client address as Express resolves it (honours `TRUST_PROXY`). */
  readonly ipAddress?: string;
  /** Cut to 512 characters. */
  readonly userAgent?: string;
  /** The audit actions written during this request (the end-to-end tests check them against the route's declaration). */
  readonly auditedActions?: Set<string>;
}

@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestScope>();

  run<T>(scope: RequestScope, work: () => T): T {
    return this.storage.run(scope, work);
  }

  current(): RequestScope | undefined {
    return this.storage.getStore();
  }
}
