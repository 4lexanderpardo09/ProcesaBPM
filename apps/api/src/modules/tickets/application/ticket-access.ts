import type { Principal } from '../../../common/auth/principal.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { TicketActor } from '../../engine/application/locked-ticket.js';
import { accessibleWhere } from '../../authorization/domain/record-access.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import type { TicketQueryRepository, Where } from '../data/ticket-query.repository.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../domain/ticket-subject.js';

/** The `where` that holds exactly the tickets the ability may read. Checked by the database, never in memory. */
export const readableTickets = (ability: AppAbility): Where => accessibleWhere(ability, TICKET_READ_ACTIONS, TICKET_SUBJECT);

/** The caller as the engine sees them: who they are, whether they may reassign, and what they may read. */
export function ticketActorOf(principal: Principal, ability: AppAbility, tenantId: string, queries: TicketQueryRepository): TicketActor {
  return {
    userId: principal.userId,
    canReassign: ability.can('reassign', TICKET_SUBJECT),
    canRead: (tx: TenantTransaction, ticketId: string) => queries.isAccessible(tx, tenantId, ticketId, readableTickets(ability)),
  };
}
