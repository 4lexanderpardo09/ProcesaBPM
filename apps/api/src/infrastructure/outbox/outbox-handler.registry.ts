import { Injectable } from '@nestjs/common';
import type { ExternalEffectHandler, TransactionalHandler } from './outbox-handler.js';

/** The handlers by event type. Modules register theirs when they start; only registered tenant types are claimed. */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly transactional = new Map<string, TransactionalHandler<never>[]>();
  private readonly external = new Map<string, ExternalEffectHandler<never, never, never>>();

  registerTransactional<P>(handler: TransactionalHandler<P>): void {
    const handlers = this.transactional.get(handler.type) ?? [];
    handlers.push(handler as TransactionalHandler<never>);
    this.transactional.set(handler.type, handlers);
  }

  /** One external effect per type: two would each send their own e-mail on every retry of the other. */
  registerExternal<P, M, R>(handler: ExternalEffectHandler<P, M, R>): void {
    const key = `${handler.scope}:${handler.type}`;
    if (this.external.has(key) || (handler.scope === 'tenant' && this.transactional.has(handler.type))) {
      throw new Error(`An event of type ${handler.type} already has a handler with an external effect`);
    }
    this.external.set(key, handler as unknown as ExternalEffectHandler<never, never, never>);
  }

  transactionalFor(type: string): readonly TransactionalHandler<never>[] {
    return this.transactional.get(type) ?? [];
  }

  externalFor(scope: 'tenant' | 'platform', type: string): ExternalEffectHandler<never, never, never> | undefined {
    return this.external.get(`${scope}:${type}`);
  }

  /** Tenant event types somebody can handle: the claim leaves every other type PENDING. */
  tenantTypes(): string[] {
    const external = [...this.external.values()].filter((handler) => handler.scope === 'tenant').map((handler) => handler.type);
    return [...new Set([...this.transactional.keys(), ...external])];
  }
}
