import type { Principal } from '../../../common/auth/principal.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { TicketActor } from '../../engine/application/locked-ticket.js';
import type { TicketCreator } from '../../engine/application/create-ticket.service.js';
import { subject } from '@casl/ability';
import { accessibleWhere } from '../../authorization/domain/record-access.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import type { TicketQueryRepository, Where } from '../data/ticket-query.repository.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../domain/ticket-subject.js';

/** The `where` that holds exactly the tickets the ability may read. Checked by the database, never in memory. */
export const readableTickets = (ability: AppAbility): Where => accessibleWhere(ability, TICKET_READ_ACTIONS, TICKET_SUBJECT);

/**
 * The caller as the engine sees them. Every question is about THIS ticket: a type-level `ability.can` is true
 * as soon as any rule exists, even one with a stored condition, so it never decides on a concrete record.
 */
export function ticketActorOf(principal: Principal, ability: AppAbility, tenantId: string, queries: TicketQueryRepository): TicketActor {
  return {
    userId: principal.userId,
    can: (tx: TenantTransaction, ticketId: string, action) => queries.isAccessible(tx, tenantId, ticketId, accessibleWhere(ability, action, TICKET_SUBJECT)),
    canRead: (tx: TenantTransaction, ticketId: string) => queries.isAccessible(tx, tenantId, ticketId, readableTickets(ability)),
  };
}

/**
 * Whether the ability lets the caller create this ticket: the stored conditions of the rule are checked against
 * the new record, which carries every field a stored condition may use (`canOnRecord` would also demand the
 * relation fields of the read scopes, which a ticket that does not exist yet cannot have).
 */
export const ticketCreatorOf = (principal: Principal, ability: AppAbility): TicketCreator => ({
  userId: principal.userId,
  mayCreate: (action, record) => ability.can(action, subject(TICKET_SUBJECT, { ...record, status: 'OPEN' }) as never),
});
