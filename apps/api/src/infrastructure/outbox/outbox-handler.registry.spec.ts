import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OutboxHandlerRegistry } from './outbox-handler.registry.js';

const schema = z.object({});
const transactional = (type: string) => ({ type, schema, handle: () => Promise.resolve() });
const external = (type: string, scope: 'tenant' | 'platform' = 'tenant') => ({ type, scope, schema, prepare: () => Promise.resolve(null), perform: () => Promise.resolve() });

describe('OutboxHandlerRegistry', () => {
  it('allows several transactional handlers per type and lists the tenant types without repeats', () => {
    const registry = new OutboxHandlerRegistry();
    registry.registerTransactional(transactional('ticket.created'));
    registry.registerTransactional(transactional('ticket.created'));
    registry.registerExternal(external('notification.email'));
    registry.registerExternal(external('email.invitation', 'platform'));
    expect(registry.transactionalFor('ticket.created')).toHaveLength(2);
    expect(registry.tenantTypes().sort()).toEqual(['notification.email', 'ticket.created']);
  });

  it('refuses a second external effect for the same type, or one next to a transactional handler', () => {
    const registry = new OutboxHandlerRegistry();
    registry.registerExternal(external('notification.email'));
    expect(() => registry.registerExternal(external('notification.email'))).toThrow();
    registry.registerTransactional(transactional('ticket.closed'));
    expect(() => registry.registerExternal(external('ticket.closed'))).toThrow();
  });

  it('finds external handlers by scope and type', () => {
    const registry = new OutboxHandlerRegistry();
    registry.registerExternal(external('email.invitation', 'platform'));
    expect(registry.externalFor('platform', 'email.invitation')).toBeDefined();
    expect(registry.externalFor('tenant', 'email.invitation')).toBeUndefined();
  });
});
