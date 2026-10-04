import { z } from 'zod';
import { uuidSchema } from '../ids.js';

export const REALTIME_PATH = '/realtime';

/** The kinds of ticket change the worker signals (a closed list: the signal is an id-only hint). */
export const TICKET_CHANGE_KINDS = [
  'ticket.created',
  'ticket.assigned',
  'ticket.transitioned',
  'ticket.closed',
  'ticket.reopened',
  'ticket.commented',
  'ticket.incident_opened',
  'ticket.incident_resolved',
  'ticket.parallel_task_completed',
] as const;
export const ticketChangeKindSchema = z.enum(TICKET_CHANGE_KINDS);
export type TicketChangeKind = z.infer<typeof ticketChangeKindSchema>;

export const RealtimeServerEvent = {
  NotificationsChanged: 'notifications.changed',
  TicketChanged: 'ticket.changed',
  TicketDocumentGenerated: 'ticket.document_generated',
  TicketAccessLost: 'ticket.access_lost',
  SyncRequired: 'sync.required',
  AuthRequired: 'auth.required',
  SessionEnded: 'session.ended',
} as const;

export const RealtimeClientEvent = {
  TicketSubscribe: 'ticket.subscribe',
  TicketUnsubscribe: 'ticket.unsubscribe',
  AuthRefresh: 'auth.refresh',
} as const;

/** Why the server ended a socket. The client decides whether to reconnect (see docs/arquitectura.md §18). */
export const SESSION_END_REASONS = [
  'TOKEN_EXPIRED',
  'SESSION_ENDED',
  'MFA_REQUIRED',
  'TENANT_SUSPENDED',
  'MAINTENANCE',
  'PERMISSIONS_CHANGED',
  'REPLACED',
  'SLOW_CONSUMER',
  'RATE_LIMITED',
  'SERVER_SHUTDOWN',
] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export const ACK_ERROR_CODES = [
  'NOT_FOUND',
  'TOO_MANY_SUBSCRIPTIONS',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'AUTH_REQUIRED',
  'TEMPORARILY_UNAVAILABLE',
  'UNAUTHENTICATED',
  'MFA_REQUIRED',
  'TENANT_SUSPENDED',
  'MAINTENANCE',
  'PERMISSIONS_CHANGED',
] as const;
export type AckErrorCode = (typeof ACK_ERROR_CODES)[number];

export const CONNECT_ERROR_CODES = ['UNAUTHENTICATED', 'MFA_REQUIRED', 'TENANT_SUSPENDED', 'MAINTENANCE', 'RATE_LIMITED', 'TEMPORARILY_UNAVAILABLE'] as const;
export type ConnectErrorCode = (typeof CONNECT_ERROR_CODES)[number];

/** What a subscriber may see of a ticket: no title, fields, comments or names. */
export interface TicketRealtimeSummary {
  readonly ticketId: string;
  readonly status: string;
  readonly currentStepId: string | null;
  readonly currentLoop: number;
  readonly assignees: ReadonlyArray<{ readonly userId: string; readonly type: string }>;
  /** A bigint as a string: the client drops a summary older than the one it shows. */
  readonly lastEventSeq: string;
}

export interface NotificationsChangedPayload {
  readonly unreadCount: number;
}
export interface TicketChangedPayload {
  readonly ticketId: string;
  readonly kinds: readonly TicketChangeKind[];
  readonly summary: TicketRealtimeSummary;
}
export interface TicketDocumentGeneratedPayload {
  readonly ticketId: string;
  readonly fileId: string;
}
export interface TicketAccessLostPayload {
  readonly ticketId: string;
}
export interface SyncRequiredPayload {
  readonly reason: 'SIGNALS_MAY_BE_LOST';
  readonly delayMs: number;
}
export interface AuthRequiredPayload {
  readonly reason: 'TOKEN_EXPIRED' | 'SESSION_CHANGED';
  readonly graceMs: number;
}
export interface SessionEndedPayload {
  readonly reason: SessionEndReason;
}

const MAX_TOKEN_LENGTH = 4096;

export const ticketSubscribeSchema = z.object({ ticketId: uuidSchema }).strict();
export type TicketSubscribeBody = z.infer<typeof ticketSubscribeSchema>;
export const authRefreshSchema = z.object({ token: z.string().min(1).max(MAX_TOKEN_LENGTH) }).strict();
export type AuthRefreshBody = z.infer<typeof authRefreshSchema>;

export type SubscribeAck = { readonly ok: true; readonly summary: TicketRealtimeSummary } | { readonly ok: false; readonly code: AckErrorCode };
export type UnsubscribeAck = { readonly ok: true };
export type AuthRefreshAck = { readonly ok: true; readonly expiresAt: string } | { readonly ok: false; readonly code: AckErrorCode };
