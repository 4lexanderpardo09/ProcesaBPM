import { notificationTypeSchema, pageResponseSchema } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

/** How often the bell asks again while the page is open (there is no live channel in the web yet). */
export const UNREAD_POLL_MS = 60_000;
export const NOTIFICATIONS_PAGE_SIZE = 25;

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  ticketId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof notificationSchema>;

export interface NotificationListParams {
  readonly unread: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export const notificationQueryKeys = {
  all: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  list: (params: NotificationListParams) => ['notifications', 'list', params] as const,
};

export function unreadCountQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: notificationQueryKeys.unreadCount,
    queryFn: ({ signal }) => client.request('/notifications/unread-count', { schema: z.object({ count: z.number().int().min(0) }), signal }),
    refetchInterval: UNREAD_POLL_MS,
    staleTime: 0,
  });
}

/** The newest first; `unread` keeps only the ones not read yet. */
export function notificationsQueryOptions(client: HttpClient, params: NotificationListParams) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.unread) query.set('unread', 'true');
  return queryOptions({
    queryKey: notificationQueryKeys.list(params),
    queryFn: ({ signal }) => client.request(`/notifications?${query.toString()}`, { schema: pageResponseSchema(notificationSchema), signal }),
    staleTime: 0,
  });
}

export function markNotificationRead(client: HttpClient, notificationId: string) {
  return client.request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
}

export function markAllNotificationsRead(client: HttpClient) {
  return client.request('/notifications/read-all', { method: 'POST', schema: z.object({ updated: z.number().int().min(0) }) });
}
