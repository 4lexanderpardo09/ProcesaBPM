import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { SUBJECT_REGISTRY } from '../authorization/application/ability.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SubjectRegistry } from '../authorization/domain/subject-registry.js';
import { EngineModule } from '../engine/engine.module.js';
import { TicketQueriesService } from './application/ticket-queries.service.js';
import { TicketQueryRepository } from './data/ticket-query.repository.js';
import { TICKET_SUBJECT, ticketSubject } from './domain/ticket-subject.js';
import { TicketsController } from './http/tickets.controller.js';

/** What people do with tickets: create, advance, reassign, close, read (with per-record authorization) and the timeline. */
@Module({
  imports: [EngineModule, AuthorizationModule],
  controllers: [TicketsController],
  providers: [TicketQueryRepository, TicketQueriesService],
})
export class TicketsModule implements OnModuleInit {
  constructor(@Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry) {}

  /** Registers `Ticket` before the application starts, so its scoped permissions are never refused. */
  onModuleInit(): void {
    this.registry.register(TICKET_SUBJECT, ticketSubject);
  }
}
