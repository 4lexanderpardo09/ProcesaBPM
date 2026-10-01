import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, NotFoundError, PermissionDeniedError, StaleTicketError, TicketNotOpenError, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type LockedTicket, type OpenClockRow, type OpenVisitRow, TicketWriteRepository } from '../data/ticket-write.repository.js';

export type TicketAction = 'transition' | 'reassign' | 'close';

/** Who acts on a ticket and what they are allowed to see: the HTTP layer builds it from the CASL ability. */
export interface TicketActor {
  readonly userId: string;
  /** Whether the ability grants `action` on this very ticket (a stored condition such as `companyId` narrows it). */
  readonly can: (tx: TenantTransaction, ticketId: string, action: TicketAction) => Promise<boolean>;
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

  /**
   * `transition`: the assignee, or a supervisor with `reassign` on this ticket; `close`: the assignee only.
   * Both need the permission for this very ticket: a type-level check would ignore stored conditions.
   */
  async assertMayAct(tx: TenantTransaction, current: TicketInProgress, actor: TicketActor, action: 'transition' | 'close'): Promise<void> {
    const ticketId = current.ticket.id;
    const allowed =
      (await actor.can(tx, ticketId, action)) &&
      (current.actorIsAssignee || (action === 'transition' && (await actor.can(tx, ticketId, 'reassign'))));
    if (!allowed) throw new PermissionDeniedError('Not allowed to act on this ticket');
  }

  /** A pool member who answers without taking the ticket takes it implicitly: the pool clock becomes theirs. */
  async takeImplicitly(tx: TenantTransaction, tenantId: string, current: TicketInProgress, userId: string): Promise<void> {
    if (!current.actorIsPoolMember) return;
    for (const clock of current.clocks.filter((candidate) => candidate.responsibleId === null)) await this.writes.assignClockResponsible(tx, tenantId, clock.id, userId);
  }

  /** The values the ticket holds, by field code. */
  async valuesOf(tx: TenantTransaction, tenantId: string, ticketId: string, document: WorkflowVersionDocument): Promise<Record<string, unknown>> {
    const stored = await this.writes.storedValues(tx, tenantId, ticketId);
    return Object.fromEntries(document.fields.filter((field) => stored.has(field.id)).map((field) => [field.code, stored.get(field.id)]));
  }
}
