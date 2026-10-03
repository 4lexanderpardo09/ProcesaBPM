import { Inject, Injectable } from '@nestjs/common';
import type { AckErrorCode, SubscribeAck, TicketRealtimeSummary, UnsubscribeAck } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import { AbilityService } from '../../authorization/application/ability.service.js';
import { TicketVisibility } from '../../tickets/application/ticket-visibility.js';
import { RoomNames } from '../domain/room-names.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import type { MessageOutcome } from './message-outcome.js';
import { RealtimeEmitter } from './realtime-emitter.js';
import { SessionGate, VERIFICATION_TIMEOUT_MS } from './session-gate.js';
import { type RealtimeSocket, sessionOf } from './socket-session.js';

const refused = (code: AckErrorCode): MessageOutcome<SubscribeAck> => ({ ack: { ok: false, code }, endWith: undefined });

/**
 * Which tickets a socket follows. Subscribing re-verifies the session and reads the ticket with the member's own
 * ability and the same filter as `GET /tickets/:id`; an unreadable, foreign or missing ticket all answer `NOT_FOUND`.
 * A subscription is never a permission: every later emission checks the record again, and a ticket that became
 * unreadable is dropped with `ticket.access_lost`.
 */
@Injectable()
export class TicketSubscriptionsService {
  constructor(
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'REALTIME_MAX_TICKET_SUBSCRIPTIONS'>,
    @Inject(SessionGate) private readonly gate: SessionGate,
    @Inject(AbilityService) private readonly abilities: AbilityService,
    @Inject(TicketVisibility) private readonly visibility: TicketVisibility,
    @Inject(DbWorkLimiter) private readonly limiter: DbWorkLimiter,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
  ) {}

  async subscribe(socket: RealtimeSocket, ticketId: string): Promise<MessageOutcome<SubscribeAck>> {
    const session = sessionOf(socket);
    if (!session.tickets.has(ticketId) && session.tickets.size >= this.config.REALTIME_MAX_TICKET_SUBSCRIPTIONS) return refused('TOO_MANY_SUBSCRIPTIONS');
    const principal = await this.gate.verify(socket);
    if (principal === undefined) return refused(session.state === 'reauth' || session.ended ? 'AUTH_REQUIRED' : 'TEMPORARILY_UNAVAILABLE');
    const summary = await this.summaryFor(principal, ticketId);
    if (summary === undefined) return refused('NOT_FOUND');
    if (session.ended) return refused('AUTH_REQUIRED');
    void socket.join(RoomNames.ticket(principal.tenantId, ticketId));
    session.tickets.add(ticketId);
    return { ack: { ok: true, summary }, endWith: undefined };
  }

  unsubscribe(socket: RealtimeSocket, ticketId: string): Promise<MessageOutcome<UnsubscribeAck>> {
    const session = sessionOf(socket);
    void socket.leave(RoomNames.ticket(session.principal.tenantId, ticketId));
    session.tickets.delete(ticketId);
    return Promise.resolve({ ack: { ok: true }, endWith: undefined });
  }

  /** The ticket as this member may see it now, or `undefined`. Bounded like all real-time database work. */
  summaryFor(principal: Principal, ticketId: string): Promise<TicketRealtimeSummary | undefined> {
    return this.limiter.run(async () => this.visibility.summaryIfReadable(principal, await this.abilities.forPrincipal(principal), ticketId), VERIFICATION_TIMEOUT_MS);
  }

  /** Drops, in one query, the subscriptions the member can no longer read (the sweep's backstop). */
  async recheck(socket: RealtimeSocket, principal: Principal): Promise<void> {
    const tickets = [...sessionOf(socket).tickets];
    if (tickets.length === 0) return;
    const readable = await this.limiter.run(async () => this.visibility.readableIds(principal, await this.abilities.forPrincipal(principal), tickets), VERIFICATION_TIMEOUT_MS);
    for (const ticketId of tickets) {
      if (!readable.has(ticketId)) this.drop(socket, ticketId);
    }
  }

  /** The socket stops following a ticket it can no longer read, and is told. */
  drop(socket: RealtimeSocket, ticketId: string): void {
    const session = sessionOf(socket);
    if (!session.tickets.delete(ticketId)) return;
    void socket.leave(RoomNames.ticket(session.principal.tenantId, ticketId));
    this.emitter.emit([socket], 'ticket.access_lost', { ticketId });
  }
}
