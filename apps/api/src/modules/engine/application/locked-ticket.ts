import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, NotFoundError, PermissionDeniedError, StaleTicketError, TicketNotOpenError, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type LockedTicket, type OpenClockRow, type OpenVisitRow, TicketWriteRepository } from '../data/ticket-write.repository.js';

/** Who acts on a ticket and what they are allowed to see: the HTTP layer builds it from the CASL ability. */
export interface TicketActor {
  readonly userId: string;
  readonly canReassign: boolean;
  /** Whether the ability lets them read this ticket (creator, assignee, observer or `read_all`). */
  readonly canRead: (tx: TenantTransaction, ticketId: string) => Promise<boolean>;
}

export interface TicketInProgress {
  readonly ticket: LockedTicket;
  readonly visit: OpenVisitRow;
  readonly clocks: readonly OpenClockRow[];
  readonly assignees: ReadonlyArray<{ readonly userId: string; readonly type: string }>;
  readonly actorIsAssignee: boolean;
  readonly actorIsPoolMember: boolean;
}

/**
 * The start of every action on an existing ticket: lock the row (so two actions on the same ticket queue),
 * then check it is open, that the caller saw the current visit (otherwise 409: someone moved it first) and
 * that the caller may act on it. Whoever cannot even read the ticket gets 404, like a ticket that does not exist.
 */
@Injectable()
export class LockedTicketLoader {
  constructor(@Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository) {}

  async load(tx: TenantTransaction, tenantId: string, ticketId: string, visitId: string, actor: TicketActor): Promise<TicketInProgress> {
    const ticket = await this.writes.lockTicket(tx, tenantId, ticketId);
    if (ticket === undefined) throw new NotFoundError();
    const assignees = await this.writes.findAssignees(tx, tenantId, ticketId);
    const own = assignees.find((assignee) => assignee.userId === actor.userId && (assignee.type === 'PRIMARY' || assignee.type === 'POOL'));
    if (own === undefined && !(await actor.canRead(tx, ticketId))) throw new NotFoundError();
    if (ticket.status !== 'OPEN') throw new TicketNotOpenError(ticket.status);
    const visit = await this.writes.findOpenVisit(tx, tenantId, ticketId);
    if (visit === null) throw new InvalidStateError('The ticket has no open step');
    if (visit.id !== visitId) throw new StaleTicketError();
    return {
      ticket,
      visit,
      clocks: await this.writes.findOpenClocks(tx, tenantId, visit.id),
      assignees,
      actorIsAssignee: own !== undefined,
      actorIsPoolMember: own?.type === 'POOL',
    };
  }

  /** The assignee acts; anyone else needs the `reassign` permission (a supervisor moving the ticket on). */
  assertMayAct(current: TicketInProgress, actor: TicketActor): void {
    if (!current.actorIsAssignee && !actor.canReassign) throw new PermissionDeniedError('Only an assignee of the step can act on the ticket');
  }

  /** The values the ticket holds, by field code. */
  async valuesOf(tx: TenantTransaction, tenantId: string, ticketId: string, document: WorkflowVersionDocument): Promise<Record<string, unknown>> {
    const stored = await this.writes.storedValues(tx, tenantId, ticketId);
    return Object.fromEntries(document.fields.filter((field) => stored.has(field.id)).map((field) => [field.code, stored.get(field.id)]));
  }
}
