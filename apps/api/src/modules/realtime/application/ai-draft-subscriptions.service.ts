import { Inject, Injectable } from '@nestjs/common';
import type { AckErrorCode, AiDraftSubscribeAck, UnsubscribeAck } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { AbilityService } from '../../authorization/application/ability.service.js';
import { RoomNames } from '../domain/room-names.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import type { MessageOutcome } from './message-outcome.js';
import { SessionGate, VERIFICATION_TIMEOUT_MS } from './session-gate.js';
import { type RealtimeSocket, sessionOf, stillVerified } from './socket-session.js';

/** A builder follows one draft; a few tabs of the same person fit. */
export const MAX_AI_DRAFT_SUBSCRIPTIONS = 5;

const refused = (code: AckErrorCode): MessageOutcome<AiDraftSubscribeAck> => ({ ack: { ok: false, code }, endWith: undefined });

/**
 * Which workflow drafts a socket follows for «Crear con IA». Following needs the same permission as reading a request
 * over HTTP (`update Workflow`); the room is the tenant's, so another tenant's draft id finds nothing. The signal only
 * carries ids and the client reads the request again with its own session, so no record is read here. Every emission
 * checks the permission again (`mayFollow`).
 */
@Injectable()
export class AiDraftSubscriptionsService {
  constructor(
    @Inject(SessionGate) private readonly gate: SessionGate,
    @Inject(AbilityService) private readonly abilities: AbilityService,
    @Inject(DbWorkLimiter) private readonly limiter: DbWorkLimiter,
  ) {}

  async subscribe(socket: RealtimeSocket, versionId: string): Promise<MessageOutcome<AiDraftSubscribeAck>> {
    const session = sessionOf(socket);
    if (!session.aiDrafts.has(versionId) && session.aiDrafts.size >= MAX_AI_DRAFT_SUBSCRIPTIONS) return refused('TOO_MANY_SUBSCRIPTIONS');
    const principal = await this.gate.verify(socket);
    if (principal === undefined) return refused(session.state === 'reauth' || session.ended ? 'AUTH_REQUIRED' : 'TEMPORARILY_UNAVAILABLE');
    if (!(await this.mayFollow(principal))) return refused('NOT_FOUND');
    if (!stillVerified(socket, principal)) return refused('AUTH_REQUIRED');
    void socket.join(RoomNames.aiDraft(principal.tenantId, versionId));
    session.aiDrafts.add(versionId);
    return { ack: { ok: true }, endWith: undefined };
  }

  unsubscribe(socket: RealtimeSocket, versionId: string): Promise<MessageOutcome<UnsubscribeAck>> {
    const session = sessionOf(socket);
    void socket.leave(RoomNames.aiDraft(session.principal.tenantId, versionId));
    session.aiDrafts.delete(versionId);
    return Promise.resolve({ ack: { ok: true }, endWith: undefined });
  }

  /** Whether this member may see the AI requests of the organization's drafts now. */
  mayFollow(principal: Principal): Promise<boolean> {
    return this.limiter.run(async () => (await this.abilities.forPrincipal(principal)).can('update', 'Workflow'), VERIFICATION_TIMEOUT_MS);
  }

  /** Stops following a draft the member may no longer see (silently: the next HTTP read answers 403). */
  drop(socket: RealtimeSocket, versionId: string): void {
    const session = sessionOf(socket);
    if (!session.aiDrafts.delete(versionId)) return;
    void socket.leave(RoomNames.aiDraft(session.principal.tenantId, versionId));
  }
}
