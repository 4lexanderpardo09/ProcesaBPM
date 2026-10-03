import { Inject, Injectable } from '@nestjs/common';
import type { TicketChangeKind } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Principal } from '../../../common/auth/principal.js';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import type { RealtimeSignal } from '../../../infrastructure/realtime/realtime-signal.js';
import { RealtimeSignalSource } from '../../../infrastructure/realtime/realtime-signal-source.js';
import { NotificationsService } from '../../notifications/application/notifications.service.js';
import { RoomNames } from '../domain/room-names.js';
import { SignalCoalescer } from '../domain/signal-coalescer.js';
import { ConnectionRegistry, groupBySession } from './connection-registry.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import { RealtimeEmitter } from './realtime-emitter.js';
import { SessionGate, VERIFICATION_TIMEOUT_MS } from './session-gate.js';
import { SocketRevalidator } from './socket-revalidator.js';
import type { RealtimeSocket } from './socket-session.js';
import { TicketSubscriptionsService } from './ticket-subscriptions.service.js';

export const COALESCING_MS = 250;
/** At most one `sync.required` per this interval after the queue overflowed. */
export const OVERFLOW_SYNC_INTERVAL_MS = 30_000;
/** Clients spread their refetch over this window. */
export const SYNC_SPREAD_MS = 10_000;
const SHUTDOWN_DRAIN_MS = 5_000;

type DataSignal = Exclude<RealtimeSignal, { k: 'access' } | { k: 'ping' }>;

/** One unit of work after coalescing: one person's counter, one ticket's changes, or one generated document. */
export type SignalWork =
  | { readonly kind: 'notifications'; readonly tenantId: string; readonly userId: string }
  | { readonly kind: 'ticket'; readonly tenantId: string; readonly ticketId: string; readonly kinds: ReadonlySet<TicketChangeKind> }
  | { readonly kind: 'document'; readonly tenantId: string; readonly ticketId: string; readonly fileId: string };

const keyOf = (work: SignalWork): string =>
  work.kind === 'notifications' ? `n:${work.tenantId}:${work.userId}` : work.kind === 'ticket' ? `t:${work.tenantId}:${work.ticketId}` : `d:${work.tenantId}:${work.ticketId}:${work.fileId}`;

const mergeWork = (current: SignalWork, incoming: SignalWork): SignalWork =>
  current.kind === 'ticket' && incoming.kind === 'ticket' ? { ...current, kinds: new Set([...current.kinds, ...incoming.kinds]) } : current;

/** A signal as units of work (a notification signal names up to 100 people). */
export function workOf(signal: DataSignal): SignalWork[] {
  if (signal.k === 'notifications') return signal.u.map((userId) => ({ kind: 'notifications', tenantId: signal.t, userId }));
  if (signal.k === 'ticket') return [{ kind: 'ticket', tenantId: signal.t, ticketId: signal.id, kinds: new Set([signal.e]) }];
  return [{ kind: 'document', tenantId: signal.t, ticketId: signal.id, fileId: signal.d }];
}

/**
 * Turns the worker's id-only signals into emissions to the local sockets that may see them. The signal is a hint and
 * never authorizes anything: before each emission the recipient's session is re-verified (`SessionGate`) and the record
 * is read with the recipient's own ability, tenant and user. The tenant in a signal only locates local rooms.
 * A signal with no local audience costs nothing; the queue is bounded (overflow: the oldest are dropped and clients
 * are told to refetch); signals are coalesced for 250 ms; database work goes through `DbWorkLimiter`.
 */
@Injectable()
export class SignalRouter {
  private readonly queue: SignalWork[] = [];
  private readonly running = new Set<Promise<unknown>>();
  private flushTimer: NodeJS.Timeout | undefined;
  private lossOccurred = false;
  private lastOverflowSyncAt = -Infinity;
  private stopped = false;

  constructor(
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'REALTIME_SIGNAL_QUEUE_MAX'>,
    @Inject(RealtimeSignalSource) private readonly source: RealtimeSignalSource,
    @Inject(ConnectionRegistry) private readonly registry: ConnectionRegistry,
    @Inject(SessionGate) private readonly gate: SessionGate,
    @Inject(SocketRevalidator) private readonly revalidator: SocketRevalidator,
    @Inject(TicketSubscriptionsService) private readonly subscriptions: TicketSubscriptionsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(DbWorkLimiter) private readonly limiter: DbWorkLimiter,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  start(): void {
    this.source.onSignal((signal) => this.accept(signal));
    this.source.onGap(() => this.requireSync());
  }

  /** Stops taking signals and lets the work in progress finish (bounded). */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.queue.length = 0;
    await Promise.race([this.whenIdle(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_MS).unref())]);
  }

  accept(signal: RealtimeSignal): void {
    if (this.stopped || signal.k === 'ping') return;
    if (signal.k === 'access') {
      this.revalidator.handleAccess(signal);
      return;
    }
    for (const work of workOf(signal)) {
      if (this.hasLocalAudience(work)) this.enqueue(work);
    }
  }

  /** Resolves when nothing waits in the queue, no flush is pending and no emission or re-verification is running. */
  async whenIdle(): Promise<void> {
    while (this.flushTimer !== undefined || this.running.size > 0) {
      if (this.running.size > 0) await Promise.allSettled([...this.running]);
      else await new Promise((resolve) => setTimeout(resolve, COALESCING_MS));
    }
    await this.revalidator.whenIdle();
  }

  /** Every local socket refetches, each after its own random delay (spreads the load). */
  requireSync(): void {
    for (const socket of this.registry.all()) {
      this.emitter.emit([socket], 'sync.required', { reason: 'SIGNALS_MAY_BE_LOST', delayMs: Math.floor(Math.random() * SYNC_SPREAD_MS) });
    }
  }

  private hasLocalAudience(work: SignalWork): boolean {
    return this.registry.hasSocketsIn(this.roomOf(work));
  }

  private roomOf(work: SignalWork): string {
    return work.kind === 'notifications' ? RoomNames.member(work.tenantId, work.userId) : RoomNames.ticket(work.tenantId, work.ticketId);
  }

  private enqueue(work: SignalWork): void {
    if (this.queue.length >= this.config.REALTIME_SIGNAL_QUEUE_MAX) {
      this.queue.shift();
      if (!this.lossOccurred) this.logger.warn('realtime.signal_dropped', { event: 'realtime.signal_dropped' });
      this.lossOccurred = true;
    }
    this.queue.push(work);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      void this.track(this.flush());
    }, COALESCING_MS);
  }

  private async flush(): Promise<void> {
    const coalescer = new SignalCoalescer<SignalWork>(mergeWork);
    for (const work of this.queue.splice(0)) coalescer.add(keyOf(work), work);
    await Promise.all(coalescer.drain().map((work) => this.dispatch(work)));
    if (this.lossOccurred && this.queue.length === 0) this.syncAfterOverflow();
  }

  private async dispatch(work: SignalWork): Promise<void> {
    try {
      if (work.kind === 'notifications') await this.dispatchNotifications(work);
      else await this.dispatchTicket(work);
    } catch (error) {
      this.logger.warn('realtime.dispatch_failed', { event: 'realtime.dispatch_failed', kind: work.kind, errorName: error instanceof Error ? error.name : typeof error });
    }
  }

  private async dispatchNotifications(work: Extract<SignalWork, { kind: 'notifications' }>): Promise<void> {
    const recipients = (await this.verified(this.registry.socketsIn(this.roomOf(work)))).filter(({ principal }) => principal.tenantId === work.tenantId && principal.userId === work.userId);
    if (recipients.length === 0) return;
    const unreadCount = await this.limiter.run(() => this.notifications.unreadCountOf(work.tenantId, work.userId), VERIFICATION_TIMEOUT_MS);
    this.emitter.emit(
      recipients.map(({ socket }) => socket),
      'notifications.changed',
      { unreadCount },
    );
  }

  private async dispatchTicket(work: Extract<SignalWork, { kind: 'ticket' | 'document' }>): Promise<void> {
    const groups = groupBySession(this.registry.socketsIn(this.roomOf(work)));
    await Promise.all(groups.map((group) => this.dispatchTicketTo(group, work)));
  }

  /** One session's sockets: one verification, one read with that member's ability. */
  private async dispatchTicketTo(group: readonly RealtimeSocket[], work: Extract<SignalWork, { kind: 'ticket' | 'document' }>): Promise<void> {
    const recipients = (await this.verified(group)).filter(({ principal }) => principal.tenantId === work.tenantId);
    const principal = recipients[0]?.principal;
    if (principal === undefined) return;
    const sockets = recipients.map(({ socket }) => socket);
    const summary = await this.subscriptions.summaryFor(principal, work.ticketId);
    if (summary === undefined) {
      for (const socket of sockets) this.subscriptions.drop(socket, work.ticketId);
      return;
    }
    if (work.kind === 'ticket') this.emitter.emit(sockets, 'ticket.changed', { ticketId: work.ticketId, kinds: [...work.kinds], summary });
    else this.emitter.emit(sockets, 'ticket.document_generated', { ticketId: work.ticketId, fileId: work.fileId });
  }

  private async verified(sockets: readonly RealtimeSocket[]): Promise<Array<{ socket: RealtimeSocket; principal: Principal }>> {
    const checked = await Promise.all(sockets.map(async (socket) => ({ socket, principal: await this.gate.verify(socket) })));
    return checked.flatMap(({ socket, principal }) => (principal === undefined ? [] : [{ socket, principal }]));
  }

  private syncAfterOverflow(): void {
    const now = performance.now();
    if (now - this.lastOverflowSyncAt < OVERFLOW_SYNC_INTERVAL_MS) return;
    this.lastOverflowSyncAt = now;
    this.lossOccurred = false;
    this.requireSync();
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.running.add(work);
    const forget = () => this.running.delete(work);
    work.then(forget, forget);
    return work;
  }
}
