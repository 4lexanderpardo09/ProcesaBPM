import { randomBytes } from 'node:crypto';
import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import pg from 'pg';
import { JsonLogger } from '../../common/logging/json-logger.js';
import type { ApiConfig } from '../../config/app-config.js';
import { API_CONFIG } from '../../config/tokens.js';
import { decodeSignal, REALTIME_CHANNEL, type RealtimeSignal } from './realtime-signal.js';
import { RealtimeSignalSource } from './realtime-signal-source.js';

/** What the listener needs of a Postgres client (a fake in the unit tests). */
export interface ListenerClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<unknown>;
  on(event: 'notification', listener: (message: { channel: string; payload?: string | undefined }) => void): unknown;
  on(event: 'error' | 'end', listener: (error?: Error) => void): unknown;
  end(): Promise<void>;
}

export const LISTENER_CLIENT_FACTORY = Symbol('LISTENER_CLIENT_FACTORY');
export type ListenerClientFactory = () => ListenerClient;

export const SELF_PING_INTERVAL_MS = 30_000;
export const SELF_PING_TIMEOUT_MS = 10_000;
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** The listener's own connection, in session mode (`LISTEN` state lives in the server session). */
export const pgListenerClientFactory = (config: Pick<ApiConfig, 'DATABASE_URL' | 'REALTIME_DATABASE_URL'>): ListenerClientFactory => () =>
  new pg.Client({
    connectionString: config.REALTIME_DATABASE_URL ?? config.DATABASE_URL,
    application_name: 'procesabpm-realtime-listener',
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

/**
 * One `LISTEN` connection per API instance. It decodes what arrives (anything that is not exactly a known signal is
 * counted and dropped), proves it is alive by sending itself a ping every 30 s (a URL that goes through a
 * transaction-mode pooler never receives it), and reconnects with backoff. After a reconnection it tells the consumers
 * that signals may have been lost.
 */
@Injectable()
export class PgSignalListener extends RealtimeSignalSource implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly signalListeners: Array<(signal: RealtimeSignal) => void> = [];
  private readonly gapListeners: Array<() => void> = [];
  private client: ListenerClient | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private pingDeadline: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private pendingNonce: string | undefined;
  private attempt = 0;
  private everConnected = false;
  private stopped = false;
  private dropped = 0;

  constructor(
    @Inject(LISTENER_CLIENT_FACTORY) private readonly createClient: ListenerClientFactory,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'REALTIME_ENABLED'>,
  ) {
    super();
  }

  onSignal(listener: (signal: RealtimeSignal) => void): void {
    this.signalListeners.push(listener);
  }

  onGap(listener: () => void): void {
    this.gapListeners.push(listener);
  }

  /** Signals that were not valid (counter for the logs; the content is never logged). */
  get droppedSignals(): number {
    return this.dropped;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.REALTIME_ENABLED) return;
    await this.connect();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    const client = this.client;
    this.client = undefined;
    if (client === undefined) return;
    try {
      await client.query('UNLISTEN *');
    } catch {
      // The connection is going away anyway.
    }
    await client.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = this.createClient();
    client.on('notification', (message) => {
      if (message.channel === REALTIME_CHANNEL && message.payload !== undefined) this.deliver(message.payload);
    });
    client.on('error', (error) => this.lost(client, 'error', error));
    client.on('end', () => this.lost(client, 'end'));
    try {
      await client.connect();
      // The channel is a constant, never built from input.
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    } catch (error) {
      await client.end().catch(() => undefined);
      this.logger.error(error, 'PgSignalListener');
      this.scheduleReconnect();
      return;
    }
    this.client = client;
    this.attempt = 0;
    const reconnected = this.everConnected;
    this.everConnected = true;
    this.logger.log(`realtime.listener_connected${reconnected ? ' (reconnected)' : ''}`, 'PgSignalListener');
    this.armPing();
    if (reconnected) this.announceGap();
  }

  private deliver(payload: string): void {
    const signal = decodeSignal(payload);
    if (signal === undefined) {
      this.dropped += 1;
      this.logger.debug('realtime.signal_invalid', 'PgSignalListener');
      return;
    }
    if (signal.k === 'ping') {
      if (signal.n === this.pendingNonce) this.pingReceived();
      return;
    }
    for (const listener of this.signalListeners) {
      try {
        listener(signal);
      } catch (error) {
        this.logger.error(error, 'PgSignalListener');
      }
    }
  }

  private armPing(): void {
    this.pingTimer = setInterval(() => void this.ping(), SELF_PING_INTERVAL_MS);
  }

  private async ping(): Promise<void> {
    const client = this.client;
    if (client === undefined || this.pendingNonce !== undefined) return;
    const nonce = randomBytes(16).toString('base64url');
    this.pendingNonce = nonce;
    this.pingDeadline = setTimeout(() => {
      this.logger.error('realtime.listener_unhealthy: the self-ping did not arrive (is the connection behind a transaction-mode pooler?)', undefined, 'PgSignalListener');
      this.lost(client, 'unhealthy');
    }, SELF_PING_TIMEOUT_MS);
    try {
      await client.query('SELECT pg_notify($1, $2)', [REALTIME_CHANNEL, JSON.stringify({ v: 1, k: 'ping', n: nonce })]);
    } catch (error) {
      this.lost(client, 'error', error instanceof Error ? error : undefined);
    }
  }

  private pingReceived(): void {
    this.pendingNonce = undefined;
    clearTimeout(this.pingDeadline);
    this.pingDeadline = undefined;
  }

  private lost(client: ListenerClient, reason: string, error?: Error): void {
    if (client !== this.client) return;
    this.client = undefined;
    this.clearTimers();
    if (error !== undefined) this.logger.error(error, 'PgSignalListener');
    this.logger.warn(`realtime.listener_lost (${reason})`, 'PgSignalListener');
    void client.end().catch(() => undefined);
    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    const base = Math.min(RECONNECT_MIN_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private announceGap(): void {
    this.logger.warn('realtime.listener_gap', 'PgSignalListener');
    for (const listener of this.gapListeners) {
      try {
        listener();
      } catch (error) {
        this.logger.error(error, 'PgSignalListener');
      }
    }
  }

  private clearTimers(): void {
    clearInterval(this.pingTimer);
    clearTimeout(this.pingDeadline);
    clearTimeout(this.reconnectTimer);
    this.pingTimer = undefined;
    this.pingDeadline = undefined;
    this.reconnectTimer = undefined;
    this.pendingNonce = undefined;
  }
}
