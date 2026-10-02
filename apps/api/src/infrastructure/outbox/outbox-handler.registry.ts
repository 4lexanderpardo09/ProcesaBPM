import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction, TenantTransaction } from '../database/transaction-scope.js';
import type { ExternalEffectHandler, RegisteredExternalHandler, TransactionalHandler } from './outbox-handler.js';

/** The handlers by event type. Modules register theirs when they start; only registered tenant types are claimed. */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly transactional = new Map<string, TransactionalHandler<never>[]>();
  private readonly external = new Map<string, RegisteredExternalHandler>();

  registerTransactional<P>(handler: TransactionalHandler<P>): void {
    const handlers = this.transactional.get(handler.type) ?? [];
    handlers.push(handler as TransactionalHandler<never>);
    this.transactional.set(handler.type, handlers);
  }

  /** One external effect per type: two would each send their own e-mail on every retry of the other. */
  registerExternal<P, M, R, Tx extends TenantTransaction | CrossTenantTransaction>(handler: ExternalEffectHandler<P, M, R, Tx>): void {
    const key = `${handler.scope}:${handler.type}`;
    if (this.external.has(key) || (handler.scope === 'tenant' && this.transactional.has(handler.type))) {
      throw new Error(`An event of type ${handler.type} already has a handler with an external effect`);
    }
    this.external.set(key, handler as unknown as RegisteredExternalHandler);
  }

  transactionalFor(type: string): readonly TransactionalHandler<never>[] {
    return this.transactional.get(type) ?? [];
  }

  externalFor(scope: 'tenant' | 'platform', type: string): RegisteredExternalHandler | undefined {
    return this.external.get(`${scope}:${type}`);
  }

  /** Tenant event types somebody can handle: the claim leaves every other type PENDING. */
  tenantTypes(): string[] {
    const external = [...this.external.values()].filter((handler) => handler.scope === 'tenant').map((handler) => handler.type);
    return [...new Set([...this.transactional.keys(), ...external])];
  }
}
