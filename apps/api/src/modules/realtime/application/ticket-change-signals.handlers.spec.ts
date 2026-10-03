import { TICKET_CHANGE_KINDS } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { PostCommitEffects } from '../../../infrastructure/outbox/post-commit-effects.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import type { RealtimeSignalPublisher } from '../../../infrastructure/realtime/realtime-signal-publisher.js';
import { TicketChangeSignalHandlers } from './ticket-change-signals.handlers.js';

const ticketId = '0199a000-0000-7000-8000-000000000004';
const tenantId = '0199a000-0000-7000-8000-000000000001';
const schema = { parse: (value: unknown) => value } as never;

function setup() {
  const registry = new OutboxHandlerRegistry();
  const publish = vi.fn().mockResolvedValue(undefined);
  const handlers = new TicketChangeSignalHandlers(registry, { publish } as unknown as RealtimeSignalPublisher);
  return { registry, handlers, publish };
}

describe('TicketChangeSignalHandlers', () => {
  it('registers exactly the ticket change kinds', () => {
    const { registry, handlers } = setup();
    handlers.onModuleInit();
    expect(registry.tenantTypes().sort()).toEqual([...TICKET_CHANGE_KINDS].sort());
  });

  it('only schedules a signal after the commit, with ids only', async () => {
    const { registry, handlers, publish } = setup();
    handlers.onModuleInit();
    const effects = new PostCommitEffects();
    const [handler] = registry.transactionalFor('ticket.transitioned');
    await handler!.handle({} as never, { id: 'e1', tenantId, type: 'ticket.transitioned', attempt: 1, createdAt: new Date(), payload: { ticketId, title: 'never sent' } } as never, effects);
    expect(publish).not.toHaveBeenCalled();
    await effects.run(() => undefined);
    expect(publish).toHaveBeenCalledWith([{ v: 1, k: 'ticket', t: tenantId, id: ticketId, e: 'ticket.transitioned' }]);
  });

  it('signals nothing for an event that names no ticket', async () => {
    const { registry, handlers, publish } = setup();
    handlers.onModuleInit();
    const effects = new PostCommitEffects();
    await registry.transactionalFor('ticket.closed')[0]!.handle({} as never, { id: 'e1', tenantId, type: 'ticket.closed', attempt: 1, createdAt: new Date(), payload: {} } as never, effects);
    await effects.run(() => undefined);
    expect(publish).not.toHaveBeenCalled();
  });

  it('refuses to start when a type would have no other handler (the event would complete with no effect)', () => {
    const { handlers } = setup();
    handlers.onModuleInit();
    expect(() => handlers.onApplicationBootstrap()).toThrow(/only handler/);
  });

  it('starts when every type has another handler', () => {
    const { registry, handlers } = setup();
    for (const kind of TICKET_CHANGE_KINDS) registry.registerTransactional({ type: kind, schema, handle: () => Promise.resolve() });
    handlers.onModuleInit();
    expect(() => handlers.onApplicationBootstrap()).not.toThrow();
  });
});
