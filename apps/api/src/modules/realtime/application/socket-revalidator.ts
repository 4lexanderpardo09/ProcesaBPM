import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import type { RealtimeSignal } from '../../../infrastructure/realtime/realtime-signal.js';
import { RoomNames } from '../domain/room-names.js';
import { SignalCoalescer } from '../domain/signal-coalescer.js';
import { ConnectionRegistry } from './connection-registry.js';
import { SessionExpiry } from './session-expiry.js';
import { SessionGate } from './session-gate.js';
import { monotonicNow, type RealtimeSocket, sessionOf } from './socket-session.js';
import { TicketSubscriptionsService } from './ticket-subscriptions.service.js';

export type AccessSignal = Extract<RealtimeSignal, { k: 'access' }>;

export const SWEEP_TICK_MS = 5_000;
/** The sweep spreads one interval's re-verifications over this many ticks. */
const TICKS_PER_INTERVAL = 12;
export const ACCESS_COALESCING_MS = 250;

/** The local sockets an access signal is about: the most specific target it names. */
export function socketsTargetedBy(signal: AccessSignal, registry: Pick<ConnectionRegistry, 'socketsIn'>): RealtimeSocket[] {
  if (signal.s !== undefined) return registry.socketsIn(RoomNames.session(signal.s));
  if (signal.t !== undefined && signal.u !== undefined) return registry.socketsIn(RoomNames.member(signal.t, signal.u));
  if (signal.t !== undefined && signal.r !== undefined) return registry.socketsIn(RoomNames.role(signal.t, signal.r));
  if (signal.u !== undefined) return registry.socketsIn(RoomNames.user(signal.u));
  if (signal.t !== undefined) return registry.socketsIn(RoomNames.tenant(signal.t));
  return [];
}

const accessKey = (signal: AccessSignal) => [signal.s, signal.t, signal.u, signal.r].map((part) => part ?? '').join('|');

/**
 * Keeps every socket's authorization current: a sweep re-verifies each socket at least every
 * `REALTIME_REVALIDATE_INTERVAL_MS` (and notices expired tokens, and drops ticket subscriptions that became
 * unreadable), and an access signal (a session revoked, a member,
 * role or tenant changed) re-verifies the sockets it names at once. A signal is never trusted: it only causes a check.
 */
@Injectable()
export class SocketRevalidator {
  private sweepTimer: NodeJS.Timeout | undefined;
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly pendingAccess = new SignalCoalescer<AccessSignal>((current) => current);
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'REALTIME_REVALIDATE_INTERVAL_MS'>,
    @Inject(ConnectionRegistry) private readonly registry: ConnectionRegistry,
    @Inject(SessionGate) private readonly gate: SessionGate,
    @Inject(SessionExpiry) private readonly expiry: SessionExpiry,
    @Inject(TicketSubscriptionsService) private readonly subscriptions: TicketSubscriptionsService,
  ) {}

  start(): void {
    this.sweepTimer ??= setInterval(() => void this.track(this.sweep()), SWEEP_TICK_MS);
    this.sweepTimer.unref();
  }

  stop(): void {
    clearInterval(this.sweepTimer);
    clearTimeout(this.flushTimer);
    this.sweepTimer = undefined;
    this.flushTimer = undefined;
    this.pendingAccess.drain();
  }

  handleAccess(signal: AccessSignal): void {
    // No local socket: nothing to check, and a flood of forged signals cannot grow the pending set.
    if (socketsTargetedBy(signal, this.registry).length === 0) return;
    this.pendingAccess.add(accessKey(signal), signal);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      void this.track(this.flushAccess());
    }, ACCESS_COALESCING_MS);
  }

  /** Re-verifies every local socket now (test hook and backstop). */
  sweepNow(): Promise<void> {
    return this.track(this.reverify(this.registry.all(), monotonicNow()));
  }

  /** Resolves when no access signal waits and no sweep or re-verification is running. */
  async whenIdle(): Promise<void> {
    while (this.flushTimer !== undefined || this.running.size > 0) {
      if (this.running.size > 0) await Promise.allSettled([...this.running]);
      else await new Promise((resolve) => setTimeout(resolve, ACCESS_COALESCING_MS));
    }
  }

  private async sweep(): Promise<void> {
    const now = monotonicNow();
    const sockets = this.registry.all();
    for (const socket of sockets) {
      if (this.expiry.isExpired(sessionOf(socket))) this.expiry.requireReauth(socket, 'TOKEN_EXPIRED');
    }
    const due = sockets
      .filter((socket) => now - sessionOf(socket).verifiedAt >= this.config.REALTIME_REVALIDATE_INTERVAL_MS)
      .sort((a, b) => sessionOf(a).verifiedAt - sessionOf(b).verifiedAt)
      .slice(0, Math.ceil(sockets.length / TICKS_PER_INTERVAL));
    // A check already in flight that started within the interval is good enough for the sweep (no duplicate query).
    await this.reverify(due, now - this.config.REALTIME_REVALIDATE_INTERVAL_MS);
  }

  private flushAccess(): Promise<void> {
    const since = monotonicNow();
    const sockets = new Set(this.pendingAccess.drain().flatMap((signal) => socketsTargetedBy(signal, this.registry)));
    return this.reverify([...sockets], since);
  }

  private async reverify(sockets: readonly RealtimeSocket[], freshSince: number): Promise<void> {
    await Promise.all(sockets.map((socket) => this.reverifyOne(socket, freshSince)));
  }

  /** A socket still accepted also loses the tickets it can no longer read. */
  private async reverifyOne(socket: RealtimeSocket, freshSince: number): Promise<void> {
    const principal = await this.gate.verify(socket, freshSince);
    // Best effort: nothing is ever emitted without a fresh per-record check, and the next sweep tries again.
    if (principal !== undefined) await this.subscriptions.recheck(socket, principal).catch(() => undefined);
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.running.add(work);
    const forget = () => this.running.delete(work);
    work.then(forget, forget);
    return work;
  }
}
