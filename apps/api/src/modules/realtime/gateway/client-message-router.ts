import { Inject, Injectable } from '@nestjs/common';
import { type AckErrorCode, authRefreshSchema, RealtimeClientEvent } from '@procesabpm/shared';
import type { z } from 'zod';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import type { MessageOutcome } from '../application/message-outcome.js';
import { RealtimeEmitter } from '../application/realtime-emitter.js';
import { SessionRefresher } from '../application/session-refresher.js';
import { monotonicNow, type RealtimeSocket, type SocketSession, sessionOf } from '../application/socket-session.js';

/** Refused messages in a row, or unknown events, after which the socket is ended as `RATE_LIMITED`. */
export const MAX_CONSECUTIVE_REFUSALS = 10;
export const MAX_UNKNOWN_EVENTS = 20;

type Ack = (answer: unknown) => void;

interface ClientMessage<B> {
  readonly schema: z.ZodType<B>;
  /** `auth.refresh` is the only message accepted while the socket waits for a new token. */
  readonly duringReauth: boolean;
  /** An extra, per-message budget on top of the socket's own. */
  readonly budget?: (session: SocketSession) => boolean;
  handle(socket: RealtimeSocket, body: B): Promise<MessageOutcome<unknown>>;
}

const refusal = (code: AckErrorCode) => ({ ok: false, code }) as const;

/**
 * The client → server messages. They are plain Socket.IO listeners, not `@SubscribeMessage` handlers (the global HTTP
 * guard would refuse those, and `architecture.spec.ts` forbids them). Each message: an ack is required; the socket's
 * token bucket; the reauth state; strict zod validation; then the application service. Handlers always answer through
 * the ack and never throw into Socket.IO; bodies are never logged.
 */
@Injectable()
export class ClientMessageRouter {
  private readonly messages: ReadonlyMap<string, ClientMessage<never>>;

  constructor(
    @Inject(SessionRefresher) refresher: SessionRefresher,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {
    const entries: Array<[string, ClientMessage<never>]> = [
      [
        RealtimeClientEvent.AuthRefresh,
        message({ schema: authRefreshSchema, duringReauth: true, budget: (session) => session.refreshes.take(monotonicNow()), handle: (socket, body) => refresher.refresh(socket, body.token) }),
      ],
    ];
    this.messages = new Map(entries);
  }

  wire(socket: RealtimeSocket): void {
    socket.onAny((event: unknown) => {
      if (typeof event !== 'string' || !this.messages.has(event)) this.unknown(socket);
    });
    for (const [event, definition] of this.messages) {
      socket.on(event, (...args: unknown[]) => void this.handle(socket, event, definition, args));
    }
  }

  private async handle(socket: RealtimeSocket, event: string, definition: ClientMessage<never>, args: readonly unknown[]): Promise<void> {
    const session = sessionOf(socket);
    const ack = args.at(-1);
    if (session.ended) return;
    if (!session.messages.take(monotonicNow()) || (definition.budget !== undefined && !definition.budget(session))) {
      this.refuse(socket, session, ack);
      return;
    }
    session.consecutiveRefusals = 0;
    if (typeof ack !== 'function') return;
    const outcome = await this.outcomeOf(socket, session, event, definition, args.length > 1 ? args[0] : undefined);
    this.answer(ack as Ack, outcome.ack);
    if (outcome.endWith !== undefined) this.emitter.end(socket, outcome.endWith);
  }

  private async outcomeOf(socket: RealtimeSocket, session: SocketSession, event: string, definition: ClientMessage<never>, body: unknown): Promise<MessageOutcome<unknown>> {
    if (session.state === 'reauth' && !definition.duringReauth) return { ack: refusal('AUTH_REQUIRED'), endWith: undefined };
    const parsed = definition.schema.safeParse(body);
    if (!parsed.success) return { ack: refusal('VALIDATION_FAILED'), endWith: undefined };
    try {
      return await definition.handle(socket, parsed.data);
    } catch (error) {
      this.logger.error('realtime.message_failed', { event: 'realtime.message_failed', message: event, socketId: socket.id, errorName: error instanceof Error ? error.name : typeof error });
      return { ack: refusal('TEMPORARILY_UNAVAILABLE'), endWith: undefined };
    }
  }

  private refuse(socket: RealtimeSocket, session: SocketSession, ack: unknown): void {
    session.consecutiveRefusals += 1;
    if (typeof ack === 'function') this.answer(ack as Ack, refusal('RATE_LIMITED'));
    if (session.consecutiveRefusals >= MAX_CONSECUTIVE_REFUSALS) this.emitter.end(socket, 'RATE_LIMITED');
  }

  private unknown(socket: RealtimeSocket): void {
    const session = sessionOf(socket);
    session.unknownEvents += 1;
    session.messages.take(monotonicNow());
    if (session.unknownEvents > MAX_UNKNOWN_EVENTS) this.emitter.end(socket, 'RATE_LIMITED');
  }

  private answer(ack: Ack, answer: unknown): void {
    try {
      ack(answer);
    } catch (error) {
      this.logger.warn('realtime.ack_failed', { event: 'realtime.ack_failed', errorName: error instanceof Error ? error.name : typeof error });
    }
  }
}

/** Keeps each message's schema and handler in step while the table holds messages of different body types. */
function message<B>(definition: ClientMessage<B>): ClientMessage<never> {
  return definition as unknown as ClientMessage<never>;
}
