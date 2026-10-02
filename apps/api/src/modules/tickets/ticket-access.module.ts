import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { SUBJECT_REGISTRY } from '../authorization/application/ability.service.js';
import { AuthorizationCoreModule } from '../authorization/authorization-core.module.js';
import { SubjectRegistry } from '../authorization/domain/subject-registry.js';
import { TicketQueryRepository } from './data/ticket-query.repository.js';
import { TICKET_SUBJECT, ticketSubject } from './domain/ticket-subject.js';

/**
 * What it takes to ask "may this member read this ticket?": the `Ticket` subject (registered before the application
 * starts, so its scoped permissions are never refused) and the query that applies the access filter in the database.
 * Shared by the API and by the worker, which checks readers before notifying them.
 */
@Module({ imports: [AuthorizationCoreModule], providers: [TicketQueryRepository], exports: [TicketQueryRepository, AuthorizationCoreModule] })
export class TicketAccessModule implements OnModuleInit {
  constructor(@Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry) {}

  onModuleInit(): void {
    this.registry.register(TICKET_SUBJECT, ticketSubject);
  }
}
