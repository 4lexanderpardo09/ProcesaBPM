import { Module } from '@nestjs/common';
import { OutboxClaimsRepository } from './outbox-claims.repository.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { OutboxHandlerRegistry } from './outbox-handler.registry.js';
import { OutboxPoller } from './outbox-poller.js';

/** The worker's outbox machinery. Handler modules import it to register their handlers; the API never does. */
@Module({ providers: [OutboxHandlerRegistry, OutboxClaimsRepository, OutboxDispatcher, OutboxPoller], exports: [OutboxHandlerRegistry, OutboxDispatcher] })
export class OutboxDispatcherModule {}
