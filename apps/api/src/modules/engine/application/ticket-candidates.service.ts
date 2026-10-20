import { Inject, Injectable } from '@nestjs/common';
import { type NamedRefResponse, NotFoundError, type TicketCandidatesQuery } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { mayReceiveIncident, mayReceiveStep, ticketActionRefusals } from '../domain/ticket-actions.js';
import type { TicketActor } from './locked-ticket.js';
import { TicketActionStateReader } from './ticket-action-state.reader.js';

/** Names as people read them (accents and case do not split the order). */
const BY_NAME = new Intl.Collator('es', { sensitivity: 'base' });

/**
 * The people the caller can hand the current step to (`reassign`) or an incident to (`incident`), by name. It answers
 * like the action it prepares: a ticket the caller cannot read is 404 and an action the caller may not take now is
 * refused with the error the action would give, so nobody learns names they could not use.
 */
@Injectable()
export class TicketCandidatesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TicketActionStateReader) private readonly states: TicketActionStateReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
  ) {}

  candidates(actor: TicketActor, ticketId: string, query: TicketCandidatesQuery): Promise<NamedRefResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      if (!(await actor.canRead(tx, ticketId))) throw new NotFoundError();
      const state = await this.states.read(tx, tenantId, ticketId, actor);
      if (state === null) throw new NotFoundError();
      const refusals = ticketActionRefusals(state);
      const refusal = query.for === 'reassign' ? refusals.reassign : refusals.openIncident;
      if (refusal !== null) throw refusal;
      const eligible = query.for === 'reassign' ? mayReceiveStep : mayReceiveIncident;
      const members = await this.people.findActiveMembersOfCompany(tx, tenantId, state.companyId);
      return members
        .filter((member) => eligible(state, member))
        .map((member) => ({ id: member.userId, name: member.name }))
        .sort((a, b) => BY_NAME.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
    });
  }
}
