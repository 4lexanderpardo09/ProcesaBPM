import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestScope {
  readonly requestId: string;
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
